using { IncidentManagement_00 as im } from '../db/schema';

/**
 * Personal Data annotations for the Audit Logging plugin (@cap-js/audit-logging).
 *
 * IMPORTANT: The DataSubjectID must reference a *scalar* field that lives on
 * the same entity (or that CAP can resolve without SQL joins). We MUST NOT
 * annotate the `customer` association or the `incident` association as the
 * DataSubjectID, because the plugin then tries to JOIN into
 * `A_BusinessPartner` (which is a remote entity with `@cds.persistence.skip`
 * and therefore has no corresponding HANA view). That produces:
 *
 *     SqlError: invalid table name:
 *     Could not find table/view INCIDENTSERVICE_A_BUSINESSPARTNER
 *
 * at `draftActivate` time. Instead we annotate the foreign-key column on the
 * Incidents entity (which is already available on both Incidents and
 * Conversations rows in HANA) as the DataSubjectID.
 *
 * The remote `A_BusinessPartner` entity itself is intentionally NOT annotated
 * as a DataSubject: reads on it are proxied to the remote service and never
 * touched by the local audit-logging pipeline.
 */

// ── Incidents is the DataSubject entity ─────────────────────────────────────
//
// The audit-log plugin uses the entity's own `ID` key as the DataSubjectID
// automatically when EntitySemantics is 'DataSubject'. No explicit
// DataSubjectID annotation is needed here.
//
// We do NOT annotate `customer` (the association to A_BusinessPartner) with
// DataSubjectID because the plugin would then try to JOIN the remote
// `A_BusinessPartner` entity (which has `@cds.persistence.skip` and no HANA
// view), causing an Internal Server Error at draftActivate time.
annotate im.Incidents with @PersonalData : {
    EntitySemantics : 'DataSubject',
    DataSubjectRole : 'Customer'
} {
    title @PersonalData.IsPotentiallyPersonal;
}

// ── Conversations reference the Incident (which is the DataSubject holder) ──
// ── Conversations references Incidents via the `incident` composition ────────
//
// For EntitySemantics 'Other', the plugin automatically traverses the
// `incident` association upward to find the DataSubject (Incidents). No
// explicit DataSubjectID annotation is needed on Conversations.
annotate im.Conversations with @PersonalData : {
    EntitySemantics : 'Other',
    DataSubjectRole : 'Customer'
} {
    author     @PersonalData.IsPotentiallyPersonal;
    message    @PersonalData.IsPotentiallyPersonal;
    attachment @PersonalData.IsPotentiallySensitive;
}
