using { IncidentManagement_00 as im } from '../db/schema';
using { ADOPTION_LAB_API_BUSINESS_PARTNER as ext } from './external/ADOPTION_LAB_API_BUSINESS_PARTNER';

service IncidentService @(path: '/incident') {

    // Incidents projection with an extra *virtual* `customerName` element.
    //
    // The `customerName` is populated at read-time by the service handler
    // (see `incident-service.js`) from the remote BusinessPartner service.
    // We expose it as a plain (non-navigational) field so that Fiori
    // annotations such as `@Common.Text: customerName` do NOT force CAP to
    // emit SQL joins against the remote `A_BusinessPartner` projection
    // (which has `@cds.persistence.skip` and therefore has no HANA view).
    entity Incidents as projection on im.Incidents {
        *,
        null as customerName : String
    };

    entity Conversations as projection on im.Conversations;
    entity Urgency       as projection on im.Urgency;
    entity Status        as projection on im.Status;

    // ── Change Tracking ────────────────────────────────────────────────
    // Track changes on selected Incidents fields. The @cap-js/change-tracking
    // plugin captures modifications and exposes them in a "Changes" history
    // section on the Fiori Object Page.
    annotate Incidents with @changelog: [title] {
        title    @changelog;
        status   @changelog: [status.code, status.name];
        urgency  @changelog: [urgency.code, urgency.name];
        customer @changelog: [customer.BusinessPartnerFullName];
    };

    // Track message updates in the conversation composition
    annotate Conversations with @changelog: [author] {
        message @changelog;
    };

    // ── Read-only projection of BusinessPartner for value help ─────────────
    // NOTE: `@cds.persistence.skip: true` must be repeated here – it is
    // NOT inherited from the underlying `ext.A_BusinessPartner` when the
    // entity is re-projected into another service. Without it the CAP
    // runtime treats the projection as backed by a HANA view (which does
    // not exist) and generates SQL joins such as
    //   `IncidentService_A_BusinessPartner`
    // during draft-edit and media-attachment reads, resulting in
    //   `SqlError: invalid table name: Could not find table/view
    //    INCIDENTSERVICE_A_BUSINESSPARTNER`.
    @readonly
    @cds.persistence.skip
    entity A_BusinessPartner as projection on ext.A_BusinessPartner {
        key BusinessPartner,
            BusinessPartnerFullName,
            BusinessPartnerName,
            FirstName,
            LastName
    };

}
