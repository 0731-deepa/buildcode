sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel"
], function (MessageToast, MessageBox, Fragment, JSONModel) {
    "use strict";

    // Cached dialog instance, keyed by owner view id so we do not leak
    // multiple fragments when the user opens the preview repeatedly.
    var mPreviewDialogs = {};

    /**
     * Extracts the direct Conversations entity path from an object-page
     * binding context path. CAP's media stream endpoint requires a
     * non-draft key such as `/Conversations(<uuid>)` – it does not
     * accept the composed `/Incidents(...)/conversations(...)` path
     * with `IsActiveEntity` segments.
     *
     * @param {string} sPath - raw binding context path
     * @returns {string} entity path pointing to /Conversations(<key>)
     */
    function buildConversationEntityPath(sPath) {
        var oMatch = sPath.match(/conversations\(([^)]+)\)/i);
        var sKey = oMatch ? oMatch[1] : null;
        if (sKey) {
            sKey = sKey.replace(/,IsActiveEntity=(true|false)/i, "")
                       .replace(/IsActiveEntity=(true|false),/i, "");
        }
        return sKey ? "/Conversations(" + sKey + ")" : sPath;
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
         * magnifier icon added to the Attachment field group. Opens a
         * dialog with an embedded PDFViewer bound to the attachment
         * stream endpoint of the current conversation.
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

            var sServiceUrl = oContext.getModel().getServiceUrl
                ? oContext.getModel().getServiceUrl()
                : "/incident/";
            var sPdfUrl = sServiceUrl.replace(/\/$/, "")
                + buildConversationEntityPath(oContext.getPath())
                + "/attachment";
            var sFileName = oContext.getProperty("attachmentFileName") || "attachment.pdf";

            // Resolve an owner control so Fragment.load can register the
            // dialog into the correct dependents hierarchy and dispose
            // it together with the view.
            var oOwner = (this && this.getView && this.getView())
                || (this && typeof this.byId === "function" && this)
                || null;
            var sOwnerId = (oOwner && oOwner.getId && oOwner.getId()) || "default";

            var oModel = new JSONModel({ source: sPdfUrl, fileName: sFileName });
            var oControllerLike = {
                onClosePDFPreview: function (oEvent) {
                    var oDialog = oEvent.getSource().getParent();
                    oDialog.close();
                }
            };

            var pDialog = mPreviewDialogs[sOwnerId];
            if (!pDialog) {
                pDialog = Fragment.load({
                    name: "incidents.ext.fragment.PDFPreviewDialog",
                    controller: oControllerLike
                }).then(function (oDialog) {
                    if (oOwner && oOwner.addDependent) {
                        oOwner.addDependent(oDialog);
                    }
                    return oDialog;
                });
                mPreviewDialogs[sOwnerId] = pDialog;
            }

            pDialog.then(function (oDialog) {
                oDialog.setModel(oModel, "pdfPreview");
                oDialog.open();
            }).catch(function (oErr) {
                MessageBox.error("Failed to open PDF preview: " + (oErr && oErr.message ? oErr.message : oErr));
            });
        }
    };
});
