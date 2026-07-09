const cds = require('@sap/cds');

/**
 * Custom handlers for the IncidentService.
 *
 * Currently only registers a no-op implementation for the bound action
 * `Conversations.previewAttachment`. The action exists purely as a UI
 * trigger for the "preview PDF" magnifier button in the Fiori Elements
 * Attachment field group – the actual preview is rendered client-side.
 */
module.exports = cds.service.impl(function () {
    const { Conversations } = this.entities;

    this.on('previewAttachment', Conversations, () => {
        // Intentionally empty: the client-side action override handles
        // opening the PDF preview dialog. Returning nothing yields a
        // 204 No Content response which the Fiori Elements framework
        // treats as a successful trigger.
    });
});
