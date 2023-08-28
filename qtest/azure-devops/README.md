# Azure DevOps - qTest synchronization with PULSE rules

Synchronizes Azure DevOps work items with qTest requirements and defects. In preview for Tricentis qTest customers.

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

The Azure DevOps supports different [processes models](https://docs.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process?view=azure-devops-2020&tabs=basic-process). Depending on the process model you might want to map different work item types with qTest requirements and defects.

| Process | Requirement          | Defect |
| ------- | -------------------- | ------ |
| Basic   | Issue                | n/a    |
| Agile   | User Story           | Bug    |
| Scrum   | Product backlog item | Bug    |
| CMMI    | Requirement          | Bug    |

Note: the Basic process template cannot distinguish between requirements and defects as different work item types. For this process template you can setup the requirement synchronization only (and skip the defect synchronization). Alternatively you can use different tags in Azure DevOps to distinguish between Issues corresponding to requirements and Issues corresponding to defects, however in this case the web hook configurations and the logic in the actions have to be adapted accordingly.

## Setup synchronization

Note: the setup steps and the sample code assume that the Azure DevOps project is set up with the `Scrum` process template. The setup steps can be easily adapted to another template using the appropriate work item type in the hooks. The actions can be also easily adapted using other fields of the work items in the synchronization code (see e.g. the `System.WorkItemType` or the `Microsoft.VSTS.TCM.ReproSteps` field in the actions' source code. See also the overview of [Azure DevOps work items fields](https://docs.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field?view=azure-devops).

### Initial steps

<!-- prettier-ignore -->
1. Import the `synchronization.json` to setup the constants, triggers, actions and rules.
2. Fill out the [constant](#constants) values.

### Setup web hooks for requirement synchronization

Create web hooks in Azure DevOps to synchronize Product Backlog Items to qTest Requirements.

| Event             | Work item type       | URL                                                                                 |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------- |
| Work item created | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |
| Work item updated | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |
| Work item deleted | Product Backlog Item | [URL of the Pulse trigger `AzureDevopsWorkItemForRequirementCreatedUpdatedDeleted`] |

### Setup web hooks for defect synchronization

<!-- prettier-ignore -->
1. Create a web hook in qTest to synchronize new defects to Azure DevOps Bugs. The web hook can be created using the [qTest API](https://api.qasymphony.com/#/webhook/createWebhook).
    `POST https://[ManagerURL]/api/v3/webhooks`

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

The qTest Manager URL unique to your organization.

Please follow [these steps](https://documentation.tricentis.com/qtest/od/en/content/pulse/constants/pulse_constants.htm#ManagerURL) to get the URL from qTest Manager.

### Constant "ProjectID"

The id of the qTest project where the Azure DevOps work items will be synchronized to.

Copy the project id from your web browser search bar:

<!-- prettier-ignore -->
* open the corresponding project in qTest Manager
* copy the first integer number in the URL
E.g. if you see the URL `https://xxx.qtestnet.com/p/123456/portal/project` in the browser then the project id is `123456`.

### Constant "RequirementParentID"

The id of the parent module in the qTest requirements hierarchy where the Azure DevOps work items will be synchronized to as Requirements. All work items will be created as flat requirements in qTest under the parent module.

You can create a new module in qTest Manager in the requirement hierarchy (e.g. "Azure DevOps") or you can select an existing module in the tree.

Copy the parent id from your web browser search bar:

<!-- prettier-ignore -->
* create a new module or select an existing one in qTest Manager
* copy the id from the query string of the URL
E.g. if you see the URL `https://xxx.qtestnet.com/p/123456/portal/project#tab=requirements&object=0&id=9876543` in the browser then the parent id is `9876543`.

### Constant "RequirementDescriptionFieldID"

The id of the "Description" field of the Requirement in your qTest project where the work item details will be synchronized to. To get this value the Field API (/api/v3/projects/{Your Project ID}/settings/requirements/fields) needs to be called. 

### Constant "AllowCreationOnUpdate"

The value `true`: if the synchronization should create a new Requirement in the event of updating an existing Azure DevOps work item that has no matching Requirement yet. This is useful if you want to synchronize existing work items that were created before the synchronization is set up. When an existing old requirement is updated the synchronization will create the missing Requirement.
The value `false`: if the synchronization should not create a new Requirement when an existing Azure DevOps work item is updated that has no matching requirement yet.

### Constant "AZDO_TOKEN"

A valid Azure DevOps personal access token with the scope of `Work Items / Read & write`.

Creating Bugs in Azure DevOps for the qTest Defects will be performed on behalf of the user owning the token. It's a good practice to create a "service user" in Azure DevOps for this purpose to separate the changes performed by the synchronization from the changes of normal users.
Please refer to the [Azure DevOps documentation](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) about managing your personal access tokens.

### Constant "AzDoProjectURL"

The URL of the Azure DevOps project.

Bugs for qTest Defects will be created in the given Azure DevOps project.
The URL has to have the form `https://dev.azure.com/[YOUR AZDO ORGANIZATION]/[YOUR AZDO PROJECT]`.

### Constant "DefectSummaryFieldID"

The id of the "Summary" field of the Defect in your qTest project where the work item details of Bugs will be synchronized to. To get this value the Field API (/api/v3/fields/defects) needs to be called. 

### Constant "DefectDescriptionFieldID"

The id of the "Description" field of the Defect in your qTest project where the work item details of Bugs will be synchronized to. To get this value the Field API (/api/v3/fields/defects) needs to be called. 

## Limitations

### Azure DevOps rate limits

The synchronization code calls the Azure DevOps API on behalf of the user owning the ["AZDO_TOKEN"](#constant-azdo_token). The synchronization is event based, hence the frequency of the API calls depends on the usage pattern of the qTest users (e.g. how often a new defect is created in qTest). The synchronization cannot handle blocked or delayed requests due to [rate limits in Azure DevOps](https://docs.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits)
