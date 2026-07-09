sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel"
], function (MessageToast, MessageBox, Fragment, JSONModel) {
    "use strict";

    // Cached PDFViewer instance, keyed by owner view id so we do not leak
    // multiple fragments when the user opens the preview repeatedly.
    var mPreviewViewers = {};

    /**
     * Revokes any blob URL currently assigned to the given PDFViewer,
     * to avoid leaking the underlying Blob in memory.
     *
     * @param {sap.m.PDFViewer} oViewer
     */
    function revokeBlobSource(oViewer) {
        if (!oViewer) { return; }
        var oModel = oViewer.getModel("pdfPreview");
        if (!oModel) { return; }
        var sPrev = oModel.getProperty("/source");
        if (sPrev && sPrev.indexOf("blob:") === 0) {
            URL.revokeObjectURL(sPrev);
        }
        oModel.setProperty("/source", "");
    }

    return {

        /**
         * Opens a file picker restricted to PDF files, uploads the selected file
         * via a PUT request to the OData attachment stream property, then refreshes
         * the binding context so the UI reflects the new attachment metadata.
         *
         * @param {sap.ui.model.odata.v4.Context} oBindingContext - binding context of the current entity
         */
        onUploadPDF: function (oBindingContext) {
            if (!oBindingContext) {
                MessageToast.show("No conversation selected.");
                return;
            }

            // Create a hidden <input type="file"> to trigger the native file picker
            var oInput = document.createElement("input");
            oInput.type = "file";
            oInput.accept = "application/pdf";

            oInput.onchange = function (oEvent) {
                var oFile = oEvent.target.files[0];
                if (!oFile) { return; }

                if (oFile.type !== "application/pdf") {
                    MessageBox.error("Please select a valid PDF file.");
                    return;
                }

                // Build the stream URL: <serviceUrl><entityPath>/attachment
                // oBindingContext.getPath() already contains the correct key
                // including IsActiveEntity, so it works for both draft and active.
                var sServiceUrl = oBindingContext.getModel().getServiceUrl
                    ? oBindingContext.getModel().getServiceUrl()
                    : "/incident/";
                var sBaseUrl = sServiceUrl.replace(/\/$/, "");
                var sUploadUrl = sBaseUrl + oBindingContext.getPath() + "/attachment";

                // Step 1: fetch a CSRF token (required by CAP for all modifying requests)
                fetch(sBaseUrl + "/", {
                    method: "HEAD",
                    headers: { "X-CSRF-Token": "Fetch" }
                })
                .then(function (oTokenResponse) {
                    var sCsrfToken = oTokenResponse.headers.get("X-CSRF-Token");

                    // Step 2: upload the PDF with the CSRF token
                    return fetch(sUploadUrl, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/pdf",
                            "Content-Disposition": "attachment; filename=\"" + oFile.name + "\"",
                            "X-CSRF-Token": sCsrfToken || ""
                        },
                        body: oFile
                    });
                })
                .then(function (oResponse) {
                    if (!oResponse.ok) {
                        return oResponse.text().then(function (sText) {
                            throw new Error(sText || oResponse.statusText);
                        });
                    }
                    // Immediately update attachment metadata on the context so the
                    // UI reflects the new filename and media type without waiting
                    // for a full round-trip refresh.
                    return oBindingContext.setProperty("attachmentFileName", oFile.name)
                        .then(function () {
                            return oBindingContext.setProperty("attachmentMediaType", "application/pdf");
                        })
                        .then(function () {
                            MessageToast.show("PDF uploaded successfully.");
                            oBindingContext.refresh();
                        });
                })
                .catch(function (oErr) {
                    MessageBox.error("Upload failed: " + oErr.message);
                });
            };

            oInput.click();
        },

        /**
         * Fiori Elements action override handler for the "Preview PDF"
         * magnifier icon added to the Attachment field group.
         *
         * Follows the pattern from the UI5 sample
         * `sap.m.sample.PDFViewerPopup`: a `sap.m.PDFViewer` instance is
         * loaded from a fragment and opened via its own `.open()` method,
         * which shows the viewer as a properly-styled popup dialog with
         * toolbar, download button and illustrated error states.
         *
         * The stream is fetched as a Blob so the browser renders it
         * inline regardless of the server's Content-Disposition: attachment
         * header (emitted by @Core.ContentDisposition.Filename).
         *
         * @param {sap.ui.model.odata.v4.Context|sap.ui.model.odata.v4.Context[]} vContexts
         *        - the context(s) passed by the Fiori Elements action framework
         */
        onPreviewPDF: function (vContexts) {
            var oContext = Array.isArray(vContexts) ? vContexts[0] : vContexts;

            // When triggered from a form (single object page), `this`
            // may be the Fiori Elements ExtensionAPI and the context
            // isn't passed – fall back to the current view context.
            if (!oContext && this && typeof this.getBindingContext === "function") {
                oContext = this.getBindingContext();
            }
            if (!oContext && this && this.getView && typeof this.getView === "function") {
                oContext = this.getView().getBindingContext();
            }
            if (!oContext) {
                MessageToast.show("No conversation selected.");
                return;
            }

            var sMediaType = oContext.getProperty("attachmentMediaType");
            if (sMediaType !== "application/pdf") {
                MessageToast.show("No PDF attachment available.");
                return;
            }

            // The binding context path already contains the composite key
            // (ID + IsActiveEntity) required by the draft-enabled entity,
            // so it can be used directly against the media stream endpoint.
            var sServiceUrl = oContext.getModel().getServiceUrl
                ? oContext.getModel().getServiceUrl()
                : "/incident/";
            var sPdfUrl = sServiceUrl.replace(/\/$/, "")
                + oContext.getPath()
                + "/attachment";
            var sFileName = oContext.getProperty("attachmentFileName") || "attachment.pdf";

            // Resolve an owner control so Fragment.load can register the
            // viewer into the correct dependents hierarchy and dispose it
            // together with the view.
            var oOwner = (this && this.getView && this.getView())
                || (this && typeof this.byId === "function" && this)
                || null;
            var sOwnerId = (oOwner && oOwner.getId && oOwner.getId()) || "default";

            // Controller-like object exposing the event handlers referenced
            // by the fragment (loaded, error, close).
            var oControllerLike = {
                onPDFLoaded: function () {
                    MessageToast.show("PDF loaded.");
                },
                onPDFError: function () {
                    MessageBox.error("The PDF could not be displayed. Please try downloading it instead.");
                },
                onClosePDFPreview: function (oEvent) {
                    // popupButtons live inside the PDFViewer's internal dialog;
                    // walk up to the PDFViewer itself and call its close().
                    var oControl = oEvent.getSource();
                    while (oControl && (!oControl.getMetadata
                        || oControl.getMetadata().getName() !== "sap.m.PDFViewer")) {
                        oControl = oControl.getParent();
                    }
                    if (oControl && typeof oControl.close === "function") {
                        oControl.close();
                    }
                }
            };

            var pViewer = mPreviewViewers[sOwnerId];
            if (!pViewer) {
                pViewer = Fragment.load({
                    name: "incidents.ext.fragment.PDFPreviewDialog",
                    controller: oControllerLike
                }).then(function (oViewer) {
                    if (oOwner && oOwner.addDependent) {
                        oOwner.addDependent(oViewer);
                    }
                    oViewer.setModel(new JSONModel({ source: "", fileName: "" }), "pdfPreview");
                    return oViewer;
                });
                mPreviewViewers[sOwnerId] = pViewer;
            }

            pViewer.then(function (oViewer) {
                var oPreviewModel = oViewer.getModel("pdfPreview");
                // Revoke previous blob URL, if any, before fetching a new one.
                revokeBlobSource(oViewer);
                oPreviewModel.setProperty("/fileName", sFileName);

                return fetch(sPdfUrl, {
                    headers: { "Accept": "application/pdf" }
                }).then(function (oResponse) {
                    if (!oResponse.ok) {
                        return oResponse.text().then(function (sText) {
                            throw new Error(sText || oResponse.statusText);
                        });
                    }
                    return oResponse.blob();
                }).then(function (oBlob) {
                    // Force the MIME type so the browser treats the blob URL
                    // as a PDF regardless of what the server sent.
                    var oPdfBlob = oBlob.type === "application/pdf"
                        ? oBlob
                        : new Blob([oBlob], { type: "application/pdf" });
                    var sBlobUrl = URL.createObjectURL(oPdfBlob);
                    oPreviewModel.setProperty("/source", sBlobUrl);
                    // Open the popup only after the source is set so the
                    // viewer renders the PDF immediately.
                    oViewer.open();
                });
            }).catch(function (oErr) {
                MessageBox.error("Failed to open PDF preview: " + (oErr && oErr.message ? oErr.message : oErr));
            });
        }
    };
});
