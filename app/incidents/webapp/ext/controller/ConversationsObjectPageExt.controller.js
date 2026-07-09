sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (MessageToast, MessageBox) {
    "use strict";

    return {

        /**
         * Formatter used by the PreviewPDF button's 'enabled' binding.
         * targetType:'any' ensures the raw value reaches this formatter
         * without UI5 trying to coerce it to boolean first.
         *
         * @param {any} vMediaType - raw value of attachmentMediaType property
         * @returns {boolean}
         */
        isAttachmentAvailable: function (vMediaType) {
            return typeof vMediaType === "string" && vMediaType.length > 0;
        },

        /**
         * Inverse of isAttachmentAvailable — used to show the "no file" message.
         *
         * @param {any} vMediaType - raw value of attachmentMediaType property
         * @returns {boolean}
         */
        isAttachmentNotAvailable: function (vMediaType) {
            return !(typeof vMediaType === "string" && vMediaType.length > 0);
        },

        /**
         * Opens a file picker restricted to PDF files, uploads the selected file
         * via a PATCH request to the OData attachment stream property, then refreshes
         * the binding context so the UI reflects the new attachment metadata.
         */
        onUploadPDF: function () {
            var oView = this.getView();
            var oContext = oView.getBindingContext();

            if (!oContext) {
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
                var sServiceUrl = oContext.getModel().getServiceUrl
                    ? oContext.getModel().getServiceUrl()
                    : "/incident/";
                var sUploadUrl = sServiceUrl.replace(/\/$/, "") + oContext.getPath() + "/attachment";

                fetch(sUploadUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": "attachment; filename=\"" + oFile.name + "\""
                    },
                    body: oFile
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
                    return oContext.setProperty("attachmentFileName", oFile.name)
                        .then(function () {
                            return oContext.setProperty("attachmentMediaType", "application/pdf");
                        })
                        .then(function () {
                            MessageToast.show("PDF uploaded successfully.");
                            oContext.refresh();
                        });
                })
                .catch(function (oErr) {
                    MessageBox.error("Upload failed: " + oErr.message);
                });
            };

            oInput.click();
        }
    };
});
