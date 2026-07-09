using IncidentService as service from '../../srv/incident-service';

annotate service.Incidents with @(
    Common.Label : 'Incident'
);

annotate service.Conversations with @(
    Common.Label : 'Conversation'
);

annotate service.Incidents with @odata.draft.enabled;

annotate service.Incidents with @(
    Capabilities.InsertRestrictions : {Insertable : true},
    Capabilities.UpdateRestrictions : {Updatable : true},
    Capabilities.DeleteRestrictions : {Deletable : true},
    UI.HeaderInfo         : {
        TypeName       : 'Incident',
        TypeNamePlural : 'Incidents',
        Title          : {Value : title},
    },
    UI.SelectionFields    : [
        urgency_code,
        customer_BusinessPartner,
    ],
    UI.LineItem           : [
        {
            $Type : 'UI.DataField',
            Label : 'Title',
            Value : title,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Urgency',
            Value : urgency_code,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Customer',
            Value : customer_BusinessPartner,
        },
    ],
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            {
                $Type : 'UI.DataField',
                Label : 'Title',
                Value : title,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Urgency',
                Value : urgency_code,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Customer',
                Value : customer_BusinessPartner,
            },
        ],
    },
    UI.Facets             : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'GeneratedFacet1',
            Label  : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ConversationsFacet',
            Label  : 'Conversations',
            Target : 'conversations/@UI.LineItem#Conversations',
        },
    ],
);

annotate service.Conversations with @odata.draft.bypass;

annotate service.Conversations with @(
    Capabilities.InsertRestrictions : {Insertable : true},
    Capabilities.UpdateRestrictions : {Updatable : true},
    Capabilities.DeleteRestrictions : {Deletable : true},
    UI.LineItem #Conversations      : [
        {
            $Type : 'UI.DataField',
            Label : 'Timestamp',
            Value : timestamp,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Author',
            Value : author,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Message',
            Value : message,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Attachment',
            Value : attachmentFileName,
        },
    ],
    UI.HeaderInfo                   : {
        TypeName       : 'Conversation',
        TypeNamePlural : 'Conversations',
        Title          : {Value : message},
        Description    : {Value : author},
    },
    UI.FieldGroup #ConvDetails      : {
        $Type : 'UI.FieldGroupType',
        Data  : [
            {
                $Type : 'UI.DataField',
                Label : 'Timestamp',
                Value : timestamp,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Author',
                Value : author,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Message',
                Value : message,
            },
        ],
    },
    UI.MediaResource                : { Stream : attachment },
    UI.FieldGroup #AttachmentGroup  : {
        $Type : 'UI.FieldGroupType',
        Label : 'Attachment',
        Data  : [
            {
                $Type                  : 'UI.DataField',
                Label                  : 'File Name',
                Value                  : attachmentFileName,
                ![@Common.FieldControl]: #ReadOnly,
            },
            {
                $Type                  : 'UI.DataField',
                Label                  : 'Media Type',
                Value                  : attachmentMediaType,
                ![@Common.FieldControl]: #ReadOnly,
            },
        ],
    },
    UI.Facets                       : [
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'ConvDetailsFacet',
            Label  : 'Conversation Details',
            Target : '@UI.FieldGroup#ConvDetails',
        },
        {
            $Type  : 'UI.ReferenceFacet',
            ID     : 'AttachmentFacet',
            Label  : 'Attachment',
            Target : '@UI.FieldGroup#AttachmentGroup',
        },
    ],
);

annotate service.Urgency with @(
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Code',
            Value : code,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Name',
            Value : name,
        },
    ],
);

