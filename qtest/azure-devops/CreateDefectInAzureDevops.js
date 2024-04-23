const { Webhooks } = require('@qasymphony/pulse-sdk');
const axios = require('axios');

exports.handler = async function ({ event, constants, triggers }, context, callback) {
    let iteration;
    if (event.iteration != undefined) {
        iteration = event.iteration;
    } else {
        iteration = 1;
    }
    const maxIterations = 4;
    const defectId = event.defect.id;
    const projectId = event.defect.project_id;
    console.log(`[Info] Create defect event received for defect '${defectId}' in project '${projectId}'`);

    if (projectId != constants.ProjectID) {
        console.log(`[Info] Project not matching '${projectId}' != '${constants.ProjectID}', exiting.`);
        return;
    }

    const defectDetails = await getDefectDetailsByIdWithRetry(defectId);
    if (!defectDetails) return;

    const bug = await createAzDoBug(defectId, defectDetails.summary, defectDetails.description, defectDetails.link);

    if (!bug) return;

    const workItemId = bug.id;
    const newSummary = `${getNamePrefix(workItemId)}${defectDetails.summary}`;
    console.log(`[Info] New defect name: ${newSummary}`);
    await updateDefectSummary(defectId, constants.DefectSummaryFieldID, newSummary);

    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    function getNamePrefix(workItemId) {
        return `WI${workItemId}: `;
    }

    function getFieldById(obj, fieldId) {
        if (!obj || !obj.properties) {
            console.log(`[Warn] Obj/properties not found.`);
            return;
        }
        const prop = obj.properties.find((p) => p.field_id == fieldId);
        if (!prop) {
            console.log(`[Warn] Property with field id '${fieldId}' not found.`);
            return;
        }

        return prop;
    }

    async function getDefectDetailsByIdWithRetry(defectId) {
        let defectDetails = undefined;
        let delay = 5000;
        let attempt = 0;
        do {
            if (attempt > 0) {
                console.log(`[Warn] Could not get defect details on attempt ${attempt}. Waiting ${delay} ms.`);
                await new Promise((r) => setTimeout(r, delay));
            }

            defectDetails = await getDefectDetailsById(defectId);

            if (defectDetails && defectDetails.summary && defectDetails.description) return defectDetails;

            attempt++;
        } while (attempt < 12);

        console.log(`[Error] Could not get defect details, user has not yet performed initial save in qTest, or defect was abandoned.`);
        if (iteration < maxIterations) {
            iteration = iteration + 1;
            console.log(`[Info] Re-executing with original parameters and iteration of ${iteration} of a maximum ${maxIterations}.`);
            event.iteration = iteration;
            emitEvent('qTestDefectSubmitted', event);
        } else {
            console.error(`[Error] Retry exceeded ${maxIterations} attempts, rule has timed out.`);
        }
    }

    async function getDefectDetailsById(defectId) {
        const defect = await getDefectById(defectId);

        if (!defect) return;

        const summaryField = getFieldById(defect, constants.DefectSummaryFieldID);
        const descriptionField = getFieldById(defect, constants.DefectDescriptionFieldID);

        if (!summaryField || !descriptionField) {
            console.log("[Error] Fields not found, exiting.");
        }

        const summary = summaryField.field_value;
        console.log(`[Info] Defect summary: ${summary}`);
        const description = descriptionField.field_value;
        console.log(`[Info] Defect description: ${description}`);
        const link = defect.web_url;
        console.log(`[Info] Defect link: ${link}`);

        return { summary: summary, description: description, link: link };
    }

    async function getDefectById(defectId) {
        const defectUrl = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/defects/${defectId}`;

        console.log(`[Info] Get defect details for '${defectId}'`);

        try {
            const response = await axios.get(defectUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `bearer ${constants.QTEST_TOKEN}`
                }
            });
            return response.data;
        } catch (error) {
            console.log("[Error] Failed to get defect by id.", error);
        }
    }

    async function createAzDoBug(defectId, name, description, link) {
        console.log(`[Info] Creating bug in Azure DevOps '${defectId}'`);
        const baseUrl = encodeIfNeeded(constants.AzDoProjectURL);
        const url = `${baseUrl}/_apis/wit/workitems/$bug?api-version=6.0`;
        const requestBody = [
            {
                op: "add",
                path: "/fields/System.Title",
                value: name,
            },
            {
                op: "add",
                path: "/fields/Microsoft.VSTS.TCM.ReproSteps",
                value: description,
            },
            {
                op: "add",
                path: "/fields/System.Tags",
                value: "qTest",
            },
            {
                op: "add",
                path: "/relations/-",
                value: {
                    rel: "Hyperlink",
                    url: link,
                },
            },
        ];
        try {
            const response = await axios.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json-patch+json',
                    'Authorization': `basic ${Buffer.from(`:${constants.AZDO_TOKEN}`).toString('base64')}`
                }
            });
            console.log(`[Info] Bug created in Azure DevOps`);
            return response.data;
        } catch (error) {
            console.log(`[Error] Failed to create bug in Azure DevOps: ${error}`);
        }
    }

    async function updateDefectSummary(defectId, fieldId, fieldValue) {
        const url = `https://${constants.ManagerURL}/api/v3/projects/${constants.ProjectID}/defects/${defectId}`;
        const requestBody = {
            properties: [
                {
                    field_id: fieldId,
                    field_value: fieldValue,
                },
            ],
        };

        console.log(`[Info] Updating defect '${defectId}'.`);

        try {
            await axios.put(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `bearer ${constants.QTEST_TOKEN}`
                }
            });
            console.log(`[Info] Defect '${defectId}' updated.`);
        } catch (error) {
            console.log(`[Error] Failed to update defect '${defectId}'.`, error);
        }
    }

    function encodeIfNeeded(url) {
        try {
            // Decode the URL to check if it's already encoded
            let decodedUrl = decodeURIComponent(url);
            // If decoding is successful, the URL was already encoded
            return url;
        } catch (e) {
            // If decoding fails, the URL needs to be encoded
            return encodeURIComponent(url);
        }
    }
};
