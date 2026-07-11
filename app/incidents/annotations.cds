using IncidentService as service from '../../srv/incident-service';

// ── Entity-level labels ─────────────────────────────────────────────────────
annotate service.Incidents with @(
    Common.Label : '{i18n>Incident}'
);
annotate service.Conversations with @(
    Common.Label : '{i18n>Conversation}'
);

// ── Enable draft & CRUD for Incidents ───────────────────────────────────────
annotate service.Incidents with @odata.draft.enabled;

// ── Make raw codes / IDs render as human-readable text ──────────────────────
annotate service.Incidents with {
    urgency  @(
        Common.Label                     : '{i18n>Urgency}',
        Common.Text                      : urgency.name,
        Common.TextArrangement           : #TextOnly,
        Common.ValueList                 : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'Urgency',
            Parameters     : [
                { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: urgency_code, ValueListProperty: 'code' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'descr' }
            ]
        }
    );
    customer @(
        Common.Label                     : '{i18n>Customer}',
        // Use the flat, virtual `customerName` element (populated at
        // read-time by the service handler from the remote BusinessPartner
        // service) instead of `customer.BusinessPartnerFullName`. Navigating
        // through the `customer` association here caused the CAP runtime to
        // emit SQL joins against `IncidentService_A_BusinessPartner`, which
        // does not exist as a HANA view (the projection has
        // `@cds.persistence.skip`) – resulting in an "invalid table name"
        // SqlError during `draftPrepare` / `draftActivate` (Create button).
        Common.Text                      : customerName,
        Common.TextArrangement           : #TextOnly,
        Common.ValueList                 : {
            $Type          : 'Common.ValueListType',
            CollectionPath : 'A_BusinessPartner',
            Parameters     : [
                { $Type: 'Common.ValueListParameterInOut', LocalDataProperty: customer_BusinessPartner, ValueListProperty: 'BusinessPartner' },
                { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'BusinessPartnerFullName' }
            ]
        }
    );
};

// ── Field-level labels (Incidents) ──────────────────────────────────────────
annotate service.Incidents with {
    title @( title: '{i18n>Title}' );
};

// ── UI for Incidents (List Report + Object Page) ────────────────────────────
annotate service.Incidents with @(
    Capabilities.InsertRestrictions : { Insertable : true },
    Capabilities.UpdateRestrictions : { Updatable  : true },
    Capabilities.DeleteRestrictions : { Deletable  : true },

    UI.HeaderInfo : {
        TypeName       : '{i18n>Incident}',
        TypeNamePlural : '{i18n>Incidents}',
        Title          : { Value : title },
        Description    : { Value : urgency.name }
    },

    UI.SelectionFields : [
        urgency_code,
        customer_BusinessPartner
    ],

    UI.LineItem : [
        { $Type : 'UI.DataField', Label : '{i18n>Title}',    Value : title                    },
        { $Type : 'UI.DataField', Label : '{i18n>Urgency}',  Value : urgency_code             },
        { $Type : 'UI.DataField', Label : '{i18n>Customer}', Value : customer_BusinessPartner }
    ],

    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Label : '{i18n>Title}',    Value : title                    },
            { $Type : 'UI.DataField', Label : '{i18n>Urgency}',  Value : urgency_code             },
            { $Type : 'UI.DataField', Label : '{i18n>Customer}', Value : customer_BusinessPartner }
        ]
    },

    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'GeneratedFacet1',
            Label  : '{i18n>GeneralInformation}',
            Target : '@UI.FieldGroup#GeneratedGroup'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ConversationsFacet',
            Label  : '{i18n>Conversations}',
            Target : 'conversations/@UI.LineItem#Conversations'
        }
    ]
);

// ── Conversations ───────────────────────────────────────────────────────────
annotate service.Conversations with @odata.draft.bypass;

annotate service.Conversations with {
    timestamp          @( title: '{i18n>Timestamp}' );
    author             @( title: '{i18n>Author}' );
    message            @( title: '{i18n>Message}' );
    attachmentFileName  @( title: '{i18n>FileName}' );
    attachmentMediaType @( title: '{i18n>MediaType}' );
};

annotate service.Conversations with @(
    Capabilities.InsertRestrictions : { Insertable : true },
    Capabilities.UpdateRestrictions : { Updatable  : true },
    Capabilities.DeleteRestrictions : { Deletable  : true },

    UI.LineItem #Conversations : [
        { $Type : 'UI.DataField', Label : '{i18n>Timestamp}',  Value : timestamp          },
        { $Type : 'UI.DataField', Label : '{i18n>Author}',     Value : author             },
        { $Type : 'UI.DataField', Label : '{i18n>Message}',    Value : message            },
        { $Type : 'UI.DataField', Label : '{i18n>Attachment}', Value : attachmentFileName }
    ],

    UI.HeaderInfo : {
        TypeName       : '{i18n>Conversation}',
        TypeNamePlural : '{i18n>Conversations}',
        Title          : { Value : message },
        Description    : { Value : author  }
    },

    UI.FieldGroup #ConvDetails : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            { $Type : 'UI.DataField', Label : '{i18n>Timestamp}', Value : timestamp },
            { $Type : 'UI.DataField', Label : '{i18n>Author}',    Value : author    },
            { $Type : 'UI.DataField', Label : '{i18n>Message}',   Value : message   }
        ]
    },

    // NOTE: UI.MediaResource intentionally removed so that Fiori Elements
    // renders the standard "Create" (Add) button on the Conversations table
    // toolbar instead of the automatic "Upload" button. File upload is still
    // handled through the custom "Upload PDF" action on the Attachment facet.

    UI.FieldGroup #AttachmentGroup : {
        $Type : 'UI.FieldGroupType',
        Label : '{i18n>Attachment}',
        Data  : [
            {
                $Type                  : 'UI.DataField',
                Label                  : '{i18n>FileName}',
                Value                  : attachmentFileName,
                ![@Common.FieldControl]: #ReadOnly
            },
            {
                $Type                  : 'UI.DataField',
                Label                  : '{i18n>MediaType}',
                Value                  : attachmentMediaType,
                ![@Common.FieldControl]: #ReadOnly
            }
        ]
    },

    UI.Facets : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ConvDetailsFacet',
            Label  : '{i18n>ConversationDetails}',
            Target : '@UI.FieldGroup#ConvDetails'
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AttachmentFacet',
            Label  : '{i18n>AttachmentDetails}',
            Target : '@UI.FieldGroup#AttachmentGroup'
        }
    ]
);

// ── Urgency Code-List (readable in value help & list) ───────────────────────
annotate service.Urgency with {
    code  @( title: '{i18n>Code}' );
    name  @( title: '{i18n>Name}' );
    descr @( title: '{i18n>Description}' );
};

annotate service.Urgency with @(
    UI.Identification : [ { Value : name } ],
    UI.LineItem       : [
        { $Type : 'UI.DataField', Label : '{i18n>Code}',        Value : code  },
        { $Type : 'UI.DataField', Label : '{i18n>Name}',        Value : name  },
        { $Type : 'UI.DataField', Label : '{i18n>Description}', Value : descr }
    ]
);
