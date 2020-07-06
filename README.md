<p align="center"><img src="https://github.com/QASymphony/pulse-community/blob/master/blob/qas-ico-logo-150x150.png"></p>

# qTest Pulse Community Marketplace
[![Platform: qTest Pulse](https://img.shields.io/badge/platform-qTest%20Pulse-blue.svg?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJYAAACWBAMAAADOL2zRAAAAD1BMVEX4XQD1XAD4XQD4XQD4XQCYqnrWAAAABHRSTlMaAGDUaHSsCwAAAgVJREFUaN7t2kuSgyAQBuAmzgEkJ9DgASzMAVLQ9z/TLMZoQDE8/kxc0KssUl8BWjQtTfIZ7UVNnBpWd2IRaPmhOC80+VY2xWzJtdp8itnQq1VEMWvxYl24LMbVut4LLdstluLS0GK2ioc1D4wgw2LWf1Z7B1hWSEnlD3F5lCTlALGMkISZIrMVkkBTZO4kyQZkPSS1A8gygkDLxcyCriiKe2pg1kg/MOtBA8wyUAv2GNnuWHaKiXuMpW9xobZWOHW+iW1Gpf30FBObREh7CSUy/DxB2207Ppojy/ZJljcw8jfapFAH1phGeXuya/WJljtJ8pNcUrRhK3W5vHzoWqmUu/gfs3Sy1VSrWtX6H+uiNtn6JvKs3dLG2y5jLRUsVpKtQMXlpr1IqzmsO9Os0CHPfNkKHRjtl63gubRa1apWtapVrWpVq1qnt856xkRayDM5su4IfYzPqYcCFw7ud62y+rHLrGs3H53t1Pl/eYnCetv9qlytalXrnJZBWgJnWaCVfN9xZI1AywAt2+OsskkS4wZWcP/41rIF2Oa+1upbR+9j7wZ35x55ygwNvN82J73DfwD7FEZg/0QP7euA9ZtYAeyDAfbnjMC+oR7czwRaMA3s/+rgfWmQfrkR2MfXz1arECsP63sUaz9m4bs/F2/4PtGyF/aZBpee2KGYWvt9s6e5JudfUo0ynUUmczsAAAAASUVORK5CYII=&style=flat)](https://www.tricentis.com/products/agile-dev-testing-qtest/powering-agile-devops-workflows-qtest-pulse/) [![Codebase: node.js](https://img.shields.io/badge/codebase-node.js-026e00.svg?logo=node.js&style=flat)](https://nodejs.org) [![License: MIT](https://img.shields.io/badge/license-MIT-A42E2B.svg?style=flat)](https://en.wikipedia.org/wiki/MIT_License)

Repository of open-source Pulse rules powered by the community.

## How It Works

<p align="center"><img width="90%" src="https://d1f5pmhur9pirz.cloudfront.net/wp-content/uploads/2018/12/pulse-flow.png"></p>

## Workflow Overviews

<p align="center"><img width="100%" src="https://github.com/QASymphony/pulse-community/blob/master/blob/Pulse%20&%20Scenario%20Workflow%20Diagram.png?raw=true"></p>

<p align="center"><img width="100%" src="https://github.com/QASymphony/pulse-community/blob/master/blob/Pulse%20&%20Tosca%20Workflow%20Diagram.png?raw=true"></p>
* It should be noted that this integration is much different than either the native qTest or the Launch Universal Agent integrations with Tosca, and thus are not compatible.

## Getting Started

For a BDD workflow, please review the [Pulse documentation](https://support.tricentis.com/community/manuals_detail.do?lang=en&version=On-Demand&module=Tricentis%20qTest%20On-Demand&url=resources/home.htm) for examples of how to set up a workflow and use Constants.  Please bear in mind that the stock rules in the Pulse v9.1 repository are NOT compatible with the rules in this respository due to updated standards and nomenclatures.

### Identify Your Workflow

It's a good idea to sit down and map out your workflow on a whiteboard.  You will want to answer the following questions:

#### Where does my workflow begin?

In a true agile environment with a CI/CD or DevOps workflow, most likely you will be triggering your builds with some sort of repository action, whether this be a simple push/commit with a smaller development environment, or an approval or merge for larger organizations.  Most Repositories (Github, Bitbucket, Gitlab, etc) maintain a feature that will allow the call of a webhook when one or more of these actions occur.  Sometimes there will be a native integration to kick off the CI/CD pipeline, but when there is not, Pulse can take charge and kick off your CI/CD pipeline via an API call.  In this case you will want to look in the [CI Tool Integrations](https://github.com/QASymphony/pulse-community/tree/master/citools) for Actions that kick off CI/CD pipelines.  In Pulse, set up a Trigger (webhook) and an Action (script) and create a rule to link the two.  Look for the Constants needed in the documentation block of the Action script and fill them in as needed in Pulse.
