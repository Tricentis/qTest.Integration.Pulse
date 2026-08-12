# Azure DevOps and qTest Synchronization

These legacy reference Actions synchronize selected Azure DevOps work items
with qTest Requirements and Defects. They predate the validation, correlation
logging, structured error handling, timeout, and completion standards used by
the maintained result and CI rules. Modernization is planned after the core
repository work; review all mappings and test in non-production before use.

`synchronization.json` is a historical import snapshot and is not maintained in
lockstep with the source files. Configure the three source Actions and their
Rules individually instead of treating that file as a current release bundle.

## Features

<!-- prettier-ignore -->
* Automatically create new qTest Requirement when a new work item is created in Azure DevOps
* Automatically update qTest Requirement when the corresponding work item is updated in Azure DevOps
* Automatically delete qTest Requirement when the corresponding work item is deleted in Azure DevOps
* Automatically create new Azure DevOps Bug when a new Defect is created in qTest
* Automatically update qTest Defect when the corresponding Bug is updated in Azure DevOps

## Concepts / Assumptions / Recommendations

### System of record

We assume that Azure DevOps is used as the system of record / source of truth.
All changes of requirements and defects should be made in AzDo (except the initial creation of the defects in qTest).

We recommend removing the following user permissions in qTest to enforce this workflow:

<!-- prettier-ignore -->
* Create Requirements
* Edit Requirements
* Delete Requirements
* Edit Defects

### Azure DevOps process models

Azure DevOps supports different [process
models](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process?view=azure-devops).
Depending on the process model, map the appropriate work item types to qTest
Requirements and Defects.

| Process | Requirement          | Defect |
| ------- | -------------------- | ------ |
| Basic   | Issue                | n/a    |
| Agile   | User Story           | Bug    |
| Scrum   | Product backlog item | Bug    |
| CMMI    | Requirement          | Bug    |

Note: the Basic process template cannot distinguish between requirements and defects as different work item types. For this process template you can setup the requirement synchronization only (and skip the defect synchronization). Alternatively you can use different tags in Azure DevOps to distinguish between Issues corresponding to requirements and Issues corresponding to defects, however in this case the web hook configurations and the logic in the actions have to be adapted accordingly.

## Setup synchronization

The current sources assume that the Azure DevOps project uses the `Scrum`
process template. Other process models require deliberate webhook filters and
field mappings. See the [Azure DevOps work-item field
reference](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field?view=azure-devops).

### Initial steps

<!-- prettier-ignore -->
1. Review the three Action usage headers and replace customer-specific mapping
   assumptions where necessary.
2. Create the Constants documented below.
3. Create separate Actions from the three maintained source files.
4. Create the Triggers and Rules described in the webhook sections below.

### Setup web hooks for requirement synchronization

Create web hooks in Azure DevOps to synchronize Product Backlog Items to qTest Requirements.

| Event             | Work item type       | URL                                                                                 |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------- |
| Work item created | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |
| Work item updated | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |
| Work item deleted | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |

### Setup web hooks for defect synchronization

<!-- prettier-ignore -->
1. Create a webhook in qTest to synchronize new Defects to Azure DevOps Bugs.
   Consult the [qTest API documentation](https://qtest.dev.tricentis.com/) for
   the current webhook contract.
   `POST https://<manager-host>/api/v3/webhooks`

    ``` javascript
    {
        "name": "DefectSubmitted",
        "url": "<URL of the Pulse trigger `qTestDefectSubmitted`>", //REPLACE
        "events": ["defect_submitted"],
        "responseType": "json",
        "projectIds": [
            0
        ],
        "secretKey": "<some secret value>" //REPLACE
    }
    ```

2. Create a web hook in Azure DevOps to synchronize updates of Bugs with the tag `qTest` to qTest Defects
    | Event | Work item type | Tag | URL |
    | ----------------- | -------------- | ----- | ---------------------------------------------------------------- |
    | Work item updated | Bug | qTest | [URL of the Pulse trigger `AzureDevopsWorkItemForDefectUpdated`] |

## Constants

### Constant "QTEST_TOKEN"

A valid qTest access Bearer token (just the token without "Bearer").

The queries and modifications in qTest will be performed on behalf of the user owning the token. It's a good practice to create a "service user" in qTest for this purpose to separate the changes performed by the synchronization from the changes of normal qTest users.
Please follow [these steps](https://documentation.tricentis.com/qtest/od/en/content/pulse/constants/pulse_constants.htm#qTestAPIToken) to get the access token value from qTest Manager.

### Constant "ManagerURL"

The base qTest Manager URL unique to your organization, without protocol.  Do not use "http/https" in the value.
FOR EXAMPLE: `myqtest.qtestnet.com`

Please follow [these steps](https://documentation.tricentis.com/qtest/od/en/content/pulse/constants/pulse_constants.htm#ManagerURL) to get the URL from qTest Manager.

### Constant "ProjectID"

The id of the qTest project where the Azure DevOps work items will be synchronized to.

Copy the project id from your web browser search bar:

<!-- prettier-ignore -->
* open the corresponding project in qTest Manager
* copy the first integer number in the URL
E.g. if you see the URL `https://myqtest.qtestnet.com/p/123456/portal/project` in the browser then the project id is `123456`.

### Constant "RequirementParentID"

The id of the parent module in the qTest requirements hierarchy where the Azure DevOps work items will be synchronized to as Requirements. All work items will be created as flat requirements in qTest under the parent module.

You can create a new module in qTest Manager in the requirement hierarchy (e.g. "Azure DevOps") or you can select an existing module in the tree.

Copy the parent id from your web browser search bar:

<!-- prettier-ignore -->
* create a new module or select an existing one in qTest Manager
* copy the id from the query string of the URL
E.g. if you see the URL `https://myqtest.qtestnet.com/p/123456/portal/project#tab=requirements&object=0&id=9876543` in the browser then the parent id is `9876543`.

### Constant "RequirementDescriptionFieldID"

The id of the "Description" field of the Requirement in your qTest project where the work item details will be synchronized to. To get this value the Field API (/api/v3/projects/{Your Project ID}/settings/requirements/fields) needs to be called. 
FOR EXAMPLE: `https://myqtest.qtestnet.com/api/v3/projects/123456/settings/requirements/fields`

### Constant "AllowCreationOnUpdate"

The value `true`: if the synchronization should create a new Requirement in the event of updating an existing Azure DevOps work item that has no matching Requirement yet. This is useful if you want to synchronize existing work items that were created before the synchronization is set up. When an existing old requirement is updated the synchronization will create the missing Requirement.
The value `false`: if the synchronization should not create a new Requirement when an existing Azure DevOps work item is updated that has no matching requirement yet.

### Constant "AZDO_TOKEN"

A valid Azure DevOps personal access token with the scope of `Work Items / Read & write`.

Creating Bugs in Azure DevOps for the qTest Defects will be performed on behalf of the user owning the token. It's a good practice to create a "service user" in Azure DevOps for this purpose to separate the changes performed by the synchronization from the changes of normal users.
Please refer to the [Azure DevOps PAT
documentation](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)
for creation, scope, storage, and rotation guidance.

### Constant "AzDoProjectURL"

The URL of the Azure DevOps project.

Bugs for qTest Defects will be created in the given Azure DevOps project.
The URL has to have the form `https://dev.azure.com/[YOUR AZDO ORGANIZATION]/[YOUR AZDO PROJECT]`.

### Constant "DefectSummaryFieldID"

The id of the "Summary" field of the Defect in your qTest project to where the work item details of Bugs will be synchronized. To get this value the Field API (/api/v3/projects/{Your Project ID}/settings/defect/fields) needs to be called. 
FOR EXAMPLE: `https://myqtest.qtestnet.com/api/v3/projects/123456/settings/defects/fields`

### Constant "DefectDescriptionFieldID"

The id of the "Description" field of the Defect in your qTest project to where the work item details of Bugs will be synchronized. To get this value the Field API (/api/v3/projects/{Your Project ID}/settings/defect/fields) needs to be called. 
FOR EXAMPLE: `https://myqtest.qtestnet.com/api/v3/projects/123456/settings/defects/fields`

## Limitations

### Azure DevOps rate limits

The synchronization code calls the Azure DevOps API on behalf of the user
owning the [`AZDO_TOKEN`](#constant-azdo_token). Request frequency therefore
depends on webhook activity. The current implementation does not coordinate
retry or backoff for [Azure DevOps rate
limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops).
