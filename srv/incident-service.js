const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    // ────────────────────────────────────────────────────────────────────────
    // Delegate READ operations on A_BusinessPartner to the external
    // OData v2 service. The external entity is only projected for value-help
    // and read access (@cds.persistence.skip → no HANA table exists for it).
    // ────────────────────────────────────────────────────────────────────────
    const ext = await cds.connect.to('ADOPTION_LAB_API_BUSINESS_PARTNER');

    this.on('READ', 'A_BusinessPartner', (req) => {
        return ext.run(req.query);
    });

    // ────────────────────────────────────────────────────────────────────────
    // Resolve `$expand=customer` on Incidents manually.
    //
    // `Incidents.customer` is an association to `A_BusinessPartner`, which is
    // a read-only projection on the remote OData v2 service (persistence
    // skipped). Fiori Elements emits `$expand=customer($select=...)` because
    // of the `@Common.Text: customer.BusinessPartnerFullName` annotation
    // (used to render the customer as a human-readable name in the UI).
    //
    // The CAP SQL generator does not know how to satisfy such an expand
    // across a remote-service boundary and instead tries to JOIN a
    // non-existent HANA view `INCIDENTSERVICE_A_BUSINESSPARTNER`, resulting
    // in the runtime error:
    //
    //     SqlError: invalid table name:
    //     Could not find table/view INCIDENTSERVICE_A_BUSINESSPARTNER ...
    //
    // Fix: strip `customer` from the expand list before CAP builds the SQL,
    // then fetch the BusinessPartner data from the remote service ourselves
    // and stitch it onto each Incidents row after the local read completes.
    // The same approach works for Incidents.drafts (draftEdit prepares the
    // active row for editing and Fiori Elements requests the expand there
    // as well).
    // ────────────────────────────────────────────────────────────────────────
    async function resolveCustomerExpand(req, results) {
        if (!results) { return; }
        const rows = Array.isArray(results) ? results : [results];
        if (!rows.length) { return; }

        // Determine which sub-columns of `customer` the client asked for.
        // Default to the two we know Fiori Elements uses for the label.
        const columns = req.query && req.query.SELECT && req.query.SELECT.columns;
        const customerCol = columns && columns.find(c =>
            c && c.ref && c.ref.length === 1 && c.ref[0] === 'customer'
        );
        if (!customerCol) { return; } // no expand requested → nothing to do

        const wanted = (customerCol.expand || [])
            .map(c => (c && c.ref && c.ref[0]) || null)
            .filter(Boolean);
        const selectFields = wanted.length
            ? Array.from(new Set(['BusinessPartner', ...wanted]))
            : ['BusinessPartner', 'BusinessPartnerFullName'];

        // Collect the distinct FK values we need to look up remotely.
        const ids = Array.from(new Set(
            rows.map(r => r && r.customer_BusinessPartner).filter(Boolean)
        ));
        if (!ids.length) {
            // No customer assigned on any row → just null out the expand.
            for (const r of rows) { r.customer = null; }
            return;
        }

        // Query the remote service in a single call.
        let remoteRows = [];
        try {
            remoteRows = await ext.run(
                SELECT.from('ADOPTION_LAB_API_BUSINESS_PARTNER.A_BusinessPartner')
                    .columns(selectFields)
                    .where({ BusinessPartner: { in: ids } })
            );
        } catch (e) {
            // Do not fail the whole request if the remote service is
            // temporarily unavailable – just log and continue with nulls.
            req.warn(200, `Could not resolve customer details: ${e.message}`);
            remoteRows = [];
        }

        const byId = new Map(remoteRows.map(bp => [bp.BusinessPartner, bp]));
        for (const r of rows) {
            r.customer = r.customer_BusinessPartner
                ? (byId.get(r.customer_BusinessPartner) || null)
                : null;
        }
    }

    // Strip the customer expand from the CQN *before* the DB runs the query
    // so no bogus JOIN is generated. We remember whether it was requested
    // via `req.locale`-independent state on the req context.
    function stripCustomerExpand(req) {
        const q = req.query;
        if (!q || !q.SELECT || !Array.isArray(q.SELECT.columns)) { return false; }
        const idx = q.SELECT.columns.findIndex(c =>
            c && c.ref && c.ref.length === 1 && c.ref[0] === 'customer'
        );
        if (idx < 0) { return false; }
        // Preserve the requested columns for after-read resolution.
        req._customerExpand = q.SELECT.columns[idx];
        // Ensure the FK is selected so we can look up the remote row later.
        const hasFk = q.SELECT.columns.some(c =>
            c && c.ref && c.ref.length === 1 && c.ref[0] === 'customer_BusinessPartner'
        );
        if (!hasFk) {
            q.SELECT.columns.push({ ref: ['customer_BusinessPartner'] });
        }
        q.SELECT.columns.splice(idx, 1);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Populate the *virtual* `customerName` element on Incidents after the
    // DB read has completed. `customerName` is used by the Fiori annotation
    //
    //     @Common.Text: customerName
    //
    // to render the human-readable BusinessPartner name in the UI. It is a
    // plain (flat) String field on the Incidents projection, so CAP does
    // NOT emit any join against the remote `A_BusinessPartner` entity when
    // that annotation is evaluated by the draft framework or by text
    // services. The value is fetched here from the remote OData v2 service
    // in a single batched call and merged into the result rows.
    // ─────────────────────────────────────────────────────────────────────
    async function fillCustomerName(rows) {
        if (!rows) { return; }
        const arr = Array.isArray(rows) ? rows : [rows];
        if (!arr.length) { return; }
        const ids = Array.from(new Set(
            arr.map(r => r && r.customer_BusinessPartner).filter(Boolean)
        ));
        if (!ids.length) {
            for (const r of arr) { if (r) { r.customerName = null; } }
            return;
        }
        let remoteRows = [];
        try {
            remoteRows = await ext.run(
                SELECT.from('ADOPTION_LAB_API_BUSINESS_PARTNER.A_BusinessPartner')
                    .columns(['BusinessPartner', 'BusinessPartnerFullName'])
                    .where({ BusinessPartner: { in: ids } })
            );
        } catch (e) {
            // Non-fatal – just leave the names null.
            remoteRows = [];
        }
        const byId = new Map(remoteRows.map(bp => [bp.BusinessPartner, bp.BusinessPartnerFullName]));
        for (const r of arr) {
            if (r) {
                r.customerName = r.customer_BusinessPartner
                    ? (byId.get(r.customer_BusinessPartner) || null)
                    : null;
            }
        }
    }

    for (const entity of ['Incidents', 'Incidents.drafts']) {
        this.before('READ', entity, (req) => {
            stripCustomerExpand(req);
        });
        this.after('READ', entity, async (results, req) => {
            // Always fill the virtual `customerName` element (cheap, batched).
            await fillCustomerName(results);
            // Also resolve `$expand=customer` if the client asked for it.
            if (!req._customerExpand) { return; }
            const fakeReq = {
                query: {
                    SELECT: { columns: [req._customerExpand] }
                },
                warn: req.warn.bind(req)
            };
            await resolveCustomerExpand(fakeReq, results);
        });
    }

});
