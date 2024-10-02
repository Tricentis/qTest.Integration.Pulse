import axios from "axios";
import { Webhooks } from "@qasymphony/pulse-sdk";

// DO NOT EDIT exported "handler" function is the entrypoint
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find((t) => t.name === name);
        if (t) {
            console.log("Invoked webhook: ", t.name);
            return new Webhooks().invoke(t, payload);
        } else {
            console.error("[ERROR]: (emitEvent) Webhook named + name + not found.");
        }
    }
    const queueProcessing = ["IN_WAITING", "IN_PROCESSING", "PENDING"];
    let queueStatus = "IN_WAITING"; // IN_WAITING, IN_PROCESSING, FAILED, PENDING and SUCCESS

    async function checkQueueStatus(id) {
        console.log("https://" + constants.ManagerURL + "/api/v3/projects/queue-processing/" + id);
        let opts = {
            url: "https://" + constants.ManagerURL + "/api/v3/projects/queue-processing/" + id,
            method: "get",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${constants.QTEST_TOKEN}`,
            },
        };

        try {
            const response = await axios(opts);
            queueStatus = response.data.state;
            emitEvent("ChatOpsEvent", {
                message: "[INFO]: Queue checked for id: " + id + ", status is now: " + queueStatus,
            });
            console.log("[INFO]: Queue checked for id: " + id + ", status is now: " + queueStatus);
            if (queueStatus == "FAILED") {
                emitEvent("ChatOpsEvent", { message: "[ERROR]: " + response.data.content });
                console.error("[ERROR]: " + response.data.content);
            }
        } catch (error) {
            console.error(error);
        }

        return;
    }

    await checkQueueStatus(body.queueId);

    if (queueProcessing.includes(queueStatus)) {
        emitEvent("CheckProcessingQueue", { queueId: body.queueId });
    }
};
