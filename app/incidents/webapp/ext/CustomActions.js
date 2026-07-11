sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "sap/base/security/URLListValidator"
], function (MessageToast, MessageBox, Fragment, JSONModel, Log, URLListValidator) {
    "use strict";

    // Dedicated logger component so all debug output can be filtered in the
    // browser console via `sap.base.Log.setLevel(4, "incidents.PDFPreview")`.
    var LOG_COMPONENT = "incidents.PDFPreview";
    Log.setLevel(Log.Level.DEBUG, LOG_COMPONENT);

    // sap.m.PDFViewer runs every `source` value through sap.base.security's
    // URLListValidator. If any Fiori launchpad / FE plugin has already
    // populated an allow-list, the default rules reject `blob:` (and
    // `data:`) URLs — which manifests as a PDFViewer `error` event with a
    // null `target` parameter and the illustrated "cannot display" state.
    //
    // Register the two schemes once at module load so our runtime-created
    // blob URLs pass validation. `.add()` is idempotent and cheap.
    (function ensurePdfSchemesAllowed() {
        try {
            URLListValidator.add("blob");
            URLListValidator.add("data");
            Log.debug(
                "Registered 'blob' and 'data' schemes with URLListValidator",
                null,
                LOG_COMPONENT
            );
        } catch (oErr) {
            Log.warning(
                "Could not extend URLListValidator: " + oErr.message,
                null,
                LOG_COMPONENT
            );
        }
    }());

    // Cached Dialog instances, keyed by conversation ID (NOT full context
    // path) so a single dialog is reused across draft <-> active transitions
    // where the path flips between IsActiveEntity=true/false.
    var mPreviewDialogs = {};

    /**
     * Extracts the stable Conversations ID from a v4 context path such as
     *   /Incidents(...)/conversations(ID=...,IsActiveEntity=...)
     * so we can use it as a draft-agnostic cache key.
     *
     * @param {string} sPath
     * @returns {string}
     */
    function extractConversationId(sPath) {
        if (!sPath) { return ""; }
        var aMatches = sPath.match(/conversations\(ID=([^,)]+)/);
        return aMatches && aMatches[1] ? aMatches[1] : sPath;
    }

    /**
     * Formats a byte count as a human-readable size string (e.g. "1.23 MB").
     *
     * @param {number} iBytes
     * @returns {string}
     */
    function formatBytes(iBytes) {
        if (!iBytes && iBytes !== 0) { return ""; }
        if (iBytes < 1024) { return iBytes + " B"; }
        var aUnits = ["KB", "MB", "GB"];
        var fSize = iBytes / 1024;
        var iUnit = 0;
        while (fSize >= 1024 && iUnit < aUnits.length - 1) {
            fSize /= 1024;
            iUnit++;
        }
        return fSize.toFixed(2) + " " + aUnits[iUnit];
    }

    /**
     * Revokes any blob URL currently assigned to the pdfPreview model of the
     * given Dialog, to avoid leaking the underlying Blob in memory.
     *
     * @param {sap.m.Dialog} oDialog
     */
    function revokeBlobSource(oDialog) {
        if (!oDialog) { return; }
        var oModel = oDialog.getModel("pdfPreview");
        if (!oModel) { return; }
        var sPrev = oModel.getProperty("/source");
        if (sPrev && sPrev.indexOf("blob:") === 0) {
            Log.debug("Revoking previous blob URL: " + sPrev, null, LOG_COMPONENT);
            URL.revokeObjectURL(sPrev);
        }
        oModel.setProperty("/source", "");
    }

    /**
     * Walks up the control hierarchy from the given control until a Dialog
     * (or any control whose metadata name matches) is found. Returns null
     * if no ancestor of that type exists.
     *
     * @param {sap.ui.core.Control} oControl
     * @param {string} sTypeName - e.g. "sap.m.Dialog"
     * @returns {sap.ui.core.Control|null}
     */
    function findAncestor(oControl, sTypeName) {
        var oCurrent = oControl;
        while (oCurrent) {
            if (oCurrent.getMetadata
                && oCurrent.getMetadata().getName() === sTypeName) {
                return oCurrent;
            }
            oCurrent = oCurrent.getParent && oCurrent.getParent();
        }
        return null;
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
         * `sap.m.sample.PDFViewerEmbedded`: a `sap.m.PDFViewer` is embedded
         * inside a resizable `sap.m.Dialog` with an explicit width/height
         * (displayType="Embedded"). This provides a stable, page-like
         * preview with a title bar, metadata subheader, and Download / Close
         * footer buttons.
         *
         * The stream is fetched as a Blob so the browser renders it
         * inline regardless of the server's Content-Disposition: attachment
         * header (emitted by @Core.ContentDisposition.Filename).
         *
         * @param {sap.ui.model.odata.v4.Context|sap.ui.model.odata.v4.Context[]} vContexts
         *        - the context(s) passed by the Fiori Elements action framework
         */
        onPreviewPDF: function (vContexts) {
            Log.info("=== onPreviewPDF invoked ===", null, LOG_COMPONENT);
            Log.debug("Raw argument type: " + (Array.isArray(vContexts) ? "Array[" + vContexts.length + "]" : typeof vContexts), null, LOG_COMPONENT);

            // Fiori Elements invokes press handlers with `this` bound to the
            // ExtensionAPI and passes either a single Context (object page)
            // or an array of Contexts (table row selection).
            var oExtensionAPI = this;
            var oContext = Array.isArray(vContexts) ? vContexts[0] : vContexts;

            if (!oContext || typeof oContext.getProperty !== "function") {
                Log.error("No valid binding context received", oContext, LOG_COMPONENT);
                MessageToast.show("No conversation selected.");
                return;
            }

            var sContextPath = oContext.getPath();
            var sMediaType = oContext.getProperty("attachmentMediaType");
            var sFileName = oContext.getProperty("attachmentFileName") || "attachment.pdf";

            Log.debug("Context path : " + sContextPath, null, LOG_COMPONENT);
            Log.debug("Media type   : " + sMediaType, null, LOG_COMPONENT);
            Log.debug("File name    : " + sFileName, null, LOG_COMPONENT);

            if (sMediaType !== "application/pdf") {
                Log.warning("Attachment is not a PDF (mediaType=" + sMediaType + ")", null, LOG_COMPONENT);
                MessageToast.show("No PDF attachment available.");
                return;
            }

            // The binding context path already contains the composite key
            // (ID + IsActiveEntity) required by the draft-enabled entity,
            // so it can be used directly against the media stream endpoint.
            var oModel = oContext.getModel();
            var sServiceUrl = oModel && oModel.getServiceUrl
                ? oModel.getServiceUrl()
                : "/incident/";
            var sPdfUrl = sServiceUrl.replace(/\/$/, "")
                + sContextPath
                + "/attachment";

            Log.debug("Service URL  : " + sServiceUrl, null, LOG_COMPONENT);
            Log.info("PDF stream URL: " + sPdfUrl, null, LOG_COMPONENT);

            // Controller-like object exposing the event handlers referenced
            // by the fragment (loaded/error/download/close/afterClose).
            var oControllerLike = {
                onPDFLoaded: function () {
                    Log.info("PDFViewer 'loaded' event fired", null, LOG_COMPONENT);
                },
                onPDFError: function (oEvent) {
                    var oTarget = oEvent.getParameter("target");
                    var sIframeSrc = oTarget && oTarget.src ? oTarget.src : "(no target)";
                    Log.error(
                        "PDFViewer 'error' event fired. iframe src=" + sIframeSrc,
                        null,
                        LOG_COMPONENT
                    );

                    // A null `target` means PDFViewer rejected the source
                    // *before* creating the iframe – typically because the
                    // URLListValidator disallowed the scheme or the browser
                    // has no built-in PDF plugin. Offer to open the blob
                    // URL in a new tab as a graceful fallback.
                    var oDialog = findAncestor(oEvent.getSource(), "sap.m.Dialog");
                    var oPreviewModel = oDialog && oDialog.getModel("pdfPreview");
                    var sBlobUrl = oPreviewModel && oPreviewModel.getProperty("/source");

                    if (sBlobUrl && sBlobUrl.indexOf("blob:") === 0) {
                        MessageBox.warning(
                            "The embedded viewer could not display this PDF. "
                            + "Would you like to open it in a new browser tab instead?",
                            {
                                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                                emphasizedAction: MessageBox.Action.YES,
                                onClose: function (sAction) {
                                    if (sAction === MessageBox.Action.YES) {
                                        Log.info(
                                            "User chose to open PDF in new tab",
                                            null,
                                            LOG_COMPONENT
                                        );
                                        window.open(sBlobUrl, "_blank", "noopener,noreferrer");
                                    }
                                }
                            }
                        );
                    } else {
                        MessageBox.error(
                            "The PDF could not be displayed. Please try downloading it instead."
                            + "\n\nDebug info:\n  iframe src: " + sIframeSrc
                        );
                    }
                },
                onDownloadPDFPreview: function (oEvent) {
                    // Walk up to the Dialog, then find the PDFViewer in its content.
                    var oDialog = findAncestor(oEvent.getSource(), "sap.m.Dialog");
                    if (!oDialog) {
                        Log.error("Download: could not locate wrapping Dialog", null, LOG_COMPONENT);
                        return;
                    }
                    var aContent = oDialog.getContent() || [];
                    for (var i = 0; i < aContent.length; i++) {
                        if (aContent[i].getMetadata
                            && aContent[i].getMetadata().getName() === "sap.m.PDFViewer"
                            && typeof aContent[i].downloadPDF === "function") {
                            Log.info("Triggering PDFViewer.downloadPDF()", null, LOG_COMPONENT);
                            aContent[i].downloadPDF();
                            return;
                        }
                    }
                    Log.warning("Download: no PDFViewer found in Dialog content", null, LOG_COMPONENT);
                },
                onClosePDFPreview: function (oEvent) {
                    var oDialog = findAncestor(oEvent.getSource(), "sap.m.Dialog");
                    if (oDialog && typeof oDialog.close === "function") {
                        Log.debug("Closing preview dialog", null, LOG_COMPONENT);
                        oDialog.close();
                    } else {
                        Log.error("Close: could not locate wrapping Dialog", null, LOG_COMPONENT);
                    }
                },
                onAfterClosePDFPreview: function (oEvent) {
                    Log.debug("Dialog afterClose - freeing blob URL", null, LOG_COMPONENT);
                    revokeBlobSource(oEvent.getSource());
                }
            };

            // Cache key: use the Conversations ID only (draft-agnostic) so a
            // single Dialog is reused across draft/active transitions of the
            // same conversation, avoiding orphaned fragments.
            var sCacheKey = extractConversationId(sContextPath);
            Log.debug("Dialog cache key: " + sCacheKey, null, LOG_COMPONENT);

            var pDialog = mPreviewDialogs[sCacheKey];
            if (!pDialog) {
                Log.info("Loading PDFPreviewDialog fragment (first time for this conversation)", null, LOG_COMPONENT);
                // Prefer the Fiori Elements ExtensionAPI.loadFragment when
                // available – it ties the fragment's lifecycle to the view
                // and ensures proper dependency injection / UIArea registration.
                var pLoad;
                if (oExtensionAPI && typeof oExtensionAPI.loadFragment === "function") {
                    Log.debug("Using ExtensionAPI.loadFragment", null, LOG_COMPONENT);
                    pLoad = oExtensionAPI.loadFragment({
                        id: "pdfPreview_" + Date.now(),
                        name: "incidents.ext.fragment.PDFPreviewDialog",
                        controller: oControllerLike
                    });
                } else {
                    Log.debug("Using core Fragment.load (no ExtensionAPI)", null, LOG_COMPONENT);
                    pLoad = Fragment.load({
                        name: "incidents.ext.fragment.PDFPreviewDialog",
                        controller: oControllerLike
                    });
                }

                pDialog = pLoad.then(function (oDialog) {
                    Log.info("Fragment loaded, dialog id=" + oDialog.getId(), null, LOG_COMPONENT);
                    oDialog.setModel(new JSONModel({
                        source: "",
                        fileName: "",
                        mediaType: "",
                        sizeText: ""
                    }), "pdfPreview");
                    return oDialog;
                }, function (oErr) {
                    Log.error("Fragment.load failed: " + (oErr && oErr.message ? oErr.message : oErr), oErr, LOG_COMPONENT);
                    throw oErr;
                });
                mPreviewDialogs[sCacheKey] = pDialog;
            } else {
                Log.debug("Reusing cached dialog for conversation " + sCacheKey, null, LOG_COMPONENT);
            }

            pDialog.then(function (oDialog) {
                var oPreviewModel = oDialog.getModel("pdfPreview");
                if (!oPreviewModel) {
                    Log.error("pdfPreview model not found on dialog", null, LOG_COMPONENT);
                    throw new Error("Internal error: preview model missing.");
                }
                // Revoke previous blob URL, if any, before fetching a new one.
                revokeBlobSource(oDialog);
                oPreviewModel.setProperty("/fileName", sFileName);
                oPreviewModel.setProperty("/mediaType", sMediaType);
                oPreviewModel.setProperty("/sizeText", "");

                Log.info("Fetching PDF stream ...", null, LOG_COMPONENT);
                var iStart = Date.now();

                return fetch(sPdfUrl, {
                    headers: { "Accept": "application/pdf" },
                    credentials: "same-origin"
                }).then(function (oResponse) {
                    Log.debug(
                        "Fetch response: status=" + oResponse.status
                        + " " + oResponse.statusText
                        + " content-type=" + oResponse.headers.get("content-type")
                        + " content-length=" + oResponse.headers.get("content-length"),
                        null,
                        LOG_COMPONENT
                    );
                    if (!oResponse.ok) {
                        return oResponse.text().then(function (sText) {
                            Log.error("Stream fetch failed. Body: " + sText, null, LOG_COMPONENT);
                            throw new Error(
                                "HTTP " + oResponse.status + " " + oResponse.statusText
                                + (sText ? " - " + sText : "")
                            );
                        });
                    }
                    return oResponse.blob();
                }).then(function (oBlob) {
                    Log.info(
                        "Stream fetched in " + (Date.now() - iStart) + "ms. "
                        + "Blob size=" + oBlob.size + " bytes, type=" + oBlob.type,
                        null,
                        LOG_COMPONENT
                    );

                    if (!oBlob.size) {
                        throw new Error(
                            "The attachment stream is empty (0 bytes). "
                            + "Please make sure a PDF has been uploaded for this conversation."
                        );
                    }

                    // Force the MIME type so the browser treats the blob URL
                    // as a PDF regardless of what the server sent.
                    var oPdfBlob = oBlob.type === "application/pdf"
                        ? oBlob
                        : new Blob([oBlob], { type: "application/pdf" });
                    var sBlobUrl = URL.createObjectURL(oPdfBlob);
                    Log.debug("Created blob URL: " + sBlobUrl, null, LOG_COMPONENT);

                    oPreviewModel.setProperty("/source", sBlobUrl);
                    oPreviewModel.setProperty("/sizeText", formatBytes(oPdfBlob.size));

                    // Open the wrapping Dialog. The embedded PDFViewer
                    // starts rendering as soon as its source is bound.
                    Log.info("Opening preview dialog", null, LOG_COMPONENT);
                    oDialog.open();
                });
            }).catch(function (oErr) {
                Log.error(
                    "onPreviewPDF failed: " + (oErr && oErr.message ? oErr.message : oErr),
                    oErr && oErr.stack ? oErr.stack : null,
                    LOG_COMPONENT
                );
                MessageBox.error(
                    "Failed to open PDF preview: "
                    + (oErr && oErr.message ? oErr.message : oErr)
                );
            });
        }
    };
});
