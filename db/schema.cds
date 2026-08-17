namespace IncidentManagement_00;

using {
    cuid,
    managed,
    sap.common.CodeList
} from '@sap/cds/common';

using {
    ADOPTION_LAB_API_BUSINESS_PARTNER.A_BusinessPartner
} from '../srv/external/ADOPTION_LAB_API_BUSINESS_PARTNER';


// ── Urgency Code List ────────────────────────────────────────────────────────

type UrgencyCode : String(1) enum {
    High   = 'H';
    Medium = 'M';
    Low    = 'L';
}

entity Urgency : CodeList {
    key code : UrgencyCode;
}


// ── Status Code List ─────────────────────────────────────────────────────────

type StatusCode : String(1) enum {
    new        = 'N';
    assigned   = 'A';
    in_process = 'I';
    on_hold    = 'H';
    resolved   = 'R';
    closed     = 'C';
}

entity Status : CodeList {
    key code        : StatusCode;
        criticality : Integer;
}


// ── Incidents ────────────────────────────────────────────────────────────────

entity Incidents : cuid {
    title         : String(100);
    status        : Association to Status;
    urgency       : Association to Urgency;
    customer      : Association to A_BusinessPartner;
    conversations : Composition of many Conversations on conversations.incident = $self;
}


// ── Conversations ────────────────────────────────────────────────────────────

entity Conversations : cuid {
    timestamp       : DateTime    @cds.on.insert : $now;
    author          : String(255) @cds.on.insert : $user;
    message         : String(100);
    attachment      : LargeBinary @Core.MediaType : attachmentMediaType
                                  @Core.AcceptableMediaTypes : ['application/pdf']
                                  @Core.ContentDisposition.Filename : attachmentFileName;
    attachmentMediaType : String  @Core.IsMediaType;
    attachmentFileName  : String;
    incident        : Association to Incidents;
}

