using { IncidentManagement_00 as im } from '../db/schema';

service IncidentService @(path: '/incident') {

    entity Incidents     as projection on im.Incidents;
    entity Conversations as projection on im.Conversations;
    entity Urgency       as projection on im.Urgency;

}
