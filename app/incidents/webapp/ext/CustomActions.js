sap.ui.define([
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (MessageToast, MessageBox) {
    "use strict";

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
        }
    };
});
