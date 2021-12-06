<p align="center"><img src="https://github.com/Tricentis/qTest.Integration.Pulse/blob/master/blob/qas-ico-logo-150x150.png"></p>

# qTest Pulse Community Marketplace
[![Platform: qTest Pulse](https://img.shields.io/badge/platform-qTest%20Pulse-blue.svg?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWBAMAAADOL2zRAAAAD1BMVEX4XQD1XAD4XQD4XQD4XQCYqnrWAAAABHRSTlMaAGDUaHSsCwAAAgVJREFUaN7t2kuSgyAQBuAmzgEkJ9DgASzMAVLQ9z/TLMZoQDE8/kxc0KssUl8BWjQtTfIZ7UVNnBpWd2IRaPmhOC80+VY2xWzJtdp8itnQq1VEMWvxYl24LMbVut4LLdstluLS0GK2ioc1D4wgw2LWf1Z7B1hWSEnlD3F5lCTlALGMkISZIrMVkkBTZO4kyQZkPSS1A8gygkDLxcyCriiKe2pg1kg/MOtBA8wyUAv2GNnuWHaKiXuMpW9xobZWOHW+iW1Gpf30FBObREh7CSUy/DxB2207Ppojy/ZJljcw8jfapFAH1phGeXuya/WJljtJ8pNcUrRhK3W5vHzoWqmUu/gfs3Sy1VSrWtX6H+uiNtn6JvKs3dLG2y5jLRUsVpKtQMXlpr1IqzmsO9Os0CHPfNkKHRjtl63gubRa1apWtapVrWpVq1qnt856xkRayDM5su4IfYzPqYcCFw7ud62y+rHLrGs3H53t1Pl/eYnCetv9qlytalXrnJZBWgJnWaCVfN9xZI1AywAt2+OsskkS4wZWcP/41rIF2Oa+1upbR+9j7wZ35x55ygwNvN82J73DfwD7FEZg/0QP7euA9ZtYAeyDAfbnjMC+oR7czwRaMA3s/+rgfWmQfrkR2MfXz1arECsP63sUaz9m4bs/F2/4PtGyF/aZBpee2KGYWvt9s6e5JudfUo0ynUUmczsAAAAASUVORK5CYII=&style=flat)](https://www.tricentis.com/products/agile-dev-testing-qtest/powering-agile-devops-workflows-qtest-pulse/) [![Codebase: node.js](https://img.shields.io/badge/codebase-node.js-026e00.svg?logo=node.js&style=flat)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/license-MIT-A42E2B.svg?style=flat)](https://en.wikipedia.org/wiki/MIT_License)

Repository of open-source qTest Pulse rules powered by the community.  [What is qTest Pulse?](https://www.tricentis.com/products/agile-dev-testing-qtest/powering-agile-devops-workflows-qtest-pulse/)

* These rules standardize Base64 Encoding the results payload to the parser endpoint for security and compatibility.
* These rules utilize standardized nomenclature for variables, Constants, and certain Triggers.
* The stock rules in the [Pulse v9.1 repository](https://github.com/QASymphony/PulseRules_v9.1) mentioned by the documentation are NOT compatible with the rules in this repository due to the above updated standards and nomenclatures.
* qTest Pulse and qTest Launch Universal Agent parsers use different API endpoints and thus are NOT compatible.

## How It Works

<p align="center"><img width="90%" src="https://d1f5pmhur9pirz.cloudfront.net/wp-content/uploads/2018/12/pulse-flow.png"></p>

## Example Workflow Overviews

<p align="center"><img width="100%" src="https://github.com/Tricentis/qTest.Integration.Pulse/blob/master/blob/Pulse%20&%20Scenario%20Workflow%20Diagram.png?raw=true"></p>

<p align="center"><img width="100%" src="https://github.com/Tricentis/qTest.Integration.Pulse/blob/master/blob/Pulse%20&%20Tosca%20Workflow%20Diagram.png?raw=true"></p>
* It should be noted that this integration is much different than either the native qTest or the Launch Universal Agent integrations with Tosca, and thus they are NOT cross-compatible.

## Getting Started

For a BDD workflow, please review the [Pulse documentation](https://support-hub.tricentis.com/open?id=manual&lang=en&path=%2Fqtest%2F10500%2Fen%2Fcontent%2Fpulse%2Fqtest_pulse_quick_start_guide.htm&product=qtest&sessionRotationTrigger=false&type=product_manual) for examples of how to set up a workflow and use Constants.  Please bear in mind that the stock rules in the [Pulse v9.1 repository](https://github.com/QASymphony/PulseRules_v9.1) mentioned by the Pulse documentation are NOT compatible with the rules in this repository due to updated standards and nomenclatures.

For a webinar that features a live demonstration of the above workflow, please go [here](https://www.tricentis.com/resources/improve-quality-in-devops-pipelines-with-agile-test-management/).

### Identify Your Workflow

It's a good idea to sit down and map out your workflow on a whiteboard.  You will want to accmplish the following steps:

#### Begin Your Workflow

In a true agile environment with a CI/CD or DevOps workflow, most likely you will be triggering your builds with some sort of repository action, whether this be a simple push/commit with a smaller development environment, or an approval or merge for larger organizations.  Most Repositories (Github, Bitbucket, Gitlab, etc) maintain a feature that will allow the call of a webhook when one or more of these actions occur.  Sometimes there will be a native integration to kick off the CI/CD pipeline, but when there is not, Pulse can take charge and kick off your CI/CD pipeline via an API call.  In this case you will want to look in the [CI Tool Integrations](https://github.com/Tricentis/qTest.Integration.Pulse/tree/master/citools) for Actions that kick off CI/CD pipelines.  In Pulse, set up a Trigger (webhook) and an Action (script) and create a Rule to link the two.  Look for the Constants needed in the documentation block of the Action script and fill them in as needed in Pulse.

#### Deliver and Parse Testing Tool or Framework Results

This is key to picking out or developing your own parser.  The output of the parser creates a standardized construct that is consumable by a qTest Manager API.  In order to leverage a parser, you will need to deliver the framework or tool results file (expecting JSON or XML) to the parser webhook endpoint with a [delivery script](https://github.com/Tricentis/qTest.Integration.Pulse/tree/master/delivery) executed by your chosen CI/CD tool.  These scripts may also be used in Launch to bypass the Universal Agent parsers and send the results to Pulse.  You will need to edit the delivery script to include the qTest Project ID, target the top level Test Cycle ID, Pulse framework parser webhook endpoint, and location of the results output file.  You can find the qTest Project and Test Cycle IDs in the URL when you select your chosen Test Cycle in qTest Manager, see below.

<p align="center"><img src="https://github.com/Tricentis/qTest.Integration.Pulse/blob/master/blob/qTestPrjTCIds.png?raw=true"></p>

There is a [selection of parsers](https://github.com/Tricentis/qTest.Integration.Pulse/tree/master/parsers) available, but they are easy to create as well.  Create a Trigger and Action with your chosen parser and link them together with a Rule.  Update your delivery script with this webhook endpoint.  To create your own parser, review [this API documentation](https://api.qasymphony.com/#/test-log/submitAutomationTestLogs2).  In the next step, you will be delivering the parser results to qTest Manager via a Pulse rule wrapped around this API, and the payload will need to match the expected input for this API.

#### Submission of Parsed Results to qTest Manager

[This rule](https://github.com/Tricentis/qTest.Integration.Pulse/blob/master/qtest/UpdateQTestWithResults.js) takes the standardized construct created by the parser, then authenticates and submits it to a qTest Manager API, as linked in the section above.  You will require a qTest API Bearer Token in order to authenticate.  For heavily automated workflows, we suggest creating a service account in qTest that has access to all automation projects to allow submission of results to any project with one account.
