# Azure DevOps - qTest synchronization with PULSE rules

Synchronizes Azure DevOps work items with qTest requirements and defects.

## Features

<!-- prettier-ignore -->
* Automatically create new qTest Requirement when a new work item is created in Azure DevOps
* Automatically update qTest Requirement when the corresponding work item is updated in Azure DevOps
* Automatically delete qTest Requirement when the corresponding work item is deleted in Azure DevOps

Planned features:

<!-- prettier-ignore -->
* Automatically create new Azure DevOps Bug when a new Defect is created in qTest
* Automatically update qTest Defect when the corresponding Bug is updated in Azure DevOps

## Concepts

The Azure DevOps supports different [processes models](https://docs.microsoft.com/en-us/azure/devops/boards/work-items/guidance/choose-process?view=azure-devops-2020&tabs=basic-process). Depending on the process model you might want to map different work item types with qTest requirements and defects.

| Process | Requirement          | Defect |
| ------- | -------------------- | ------ |
| Basic   | Issue                | n/a    |
| Agile   | User Story           | Bug    |
| Scrum   | Product backlog item | Bug    |
| CMMI    | Requirement          | Bug    |

## Constants

### Constant "QTEST_TOKEN"

A valid qTest access token.

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

### Constant "ParentID"

The id of the parent module in the qTest requirements hierarchy where the Azure DevOps work items will be synchronized to as Requirements.

You can create a new module in qTest Manager in the requirement hierarchy (e.g. "Azure DevOps") or you can select an existing module in the tree.

Copy the parent id from your web browser search bar:

<!-- prettier-ignore -->
* create a new module or select an existing one in qTest Manager
* copy the id from the query string of the URL
E.g. if you see the URL `https://xxx.qtestnet.com/p/123456/portal/project#tab=requirements&object=0&id=9876543` in the browser then the parent id is `9876543`.

### Constant "DescriptionFieldID"

The id of the "Description" field where the work item details will be synchronized to.

### Constant "AllowCreationOnUpdate"

The value `true`: if the synchronization should create a new Requirement in the event of updating an existing Azure DevOps work item that has no matching Requirement yet. This is useful if you want to synchronize existing work items that were created before the synchronization is set up. When an existing old requirement is updated the synchronization will create the missing Requirement.
The value `false`: if the synchronization should not create a new Requirement when an existing Azure DevOps work item is updated that has no matching requirement yet.
