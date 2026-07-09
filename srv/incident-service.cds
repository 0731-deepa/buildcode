using { IncidentManagement_00 as im } from '../db/schema';

service IncidentService @(path: '/incident') {

    entity Incidents     as projection on im.Incidents;

    entity Conversations as projection on im.Conversations actions {
        // Bound action used purely as a UI trigger for the "preview PDF"
        // magnifier icon in the Attachment field group. The backend is a
        // no-op; the actual preview is rendered client-side by the Fiori
        // Elements action override in the incidents app.
        @Common.SideEffects: { TargetEntities: [] }
        action previewAttachment();
    };

    entity Urgency       as projection on im.Urgency;

}
