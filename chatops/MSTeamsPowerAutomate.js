/**
 * Trigger name: ChatOpsEvent
 * Call source: other Pulse Actions via the emitEvent() function
 * Payload example:
    *   {
    *     "message": "insert message contents here"
    *   }
 * Constants example:
    * TeamsWebhook: https://prod-209.locale.logic.azure.com:443/workflows/7460761ff1714e0883f4896719d78774/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=kZRjea7kK9mswYwpjEUpakswi1bGpaWQeIstK4PBcsU
 * Outputs:
    * The "message" object in the payload will be sent to a configured Microsoft Power Automate webhook
 * Prerequisites: configured Power Automate webhook connector for Microsoft Teams
 * Information: This method is the best practice for connecting to Microsoft Teams, as the Teams webhook connectors will be sunset by December 2025.
    * All existing connectors within all clouds will continue to work until December 2025, however using connectors beyond December 31, 2024 will require additional action.
    * Connector owners will be required to update the respective URL to post by December 31st, 2024. 
    * At least 90 days prior to the December 31, 2024 deadline, we will send further guidance about making this URL update. 
    * If the URL is not updated by December 31, 2024 the connector will stop working. 
    * This is due to further service hardening updates being implemented for Office 365 connectors in alignment with Microsoft’s Secure Future Initiative
    * Starting August 15th, 2024 all new creations should be created using the Workflows app in Microsoft Teams
 * External documentation: 
    * https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/
    * https://learn.microsoft.com/en-us/connectors/teams/?tabs=text1%2Cdotnet#microsoft-teams-webhook
 */

const axios = require('axios');
exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    try {
        const response = await axios.post(constants.TeamsWebhook, {
            "type": "message",
            "attachments": [
                {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.2",
                    "body": [
                    {
                        "type": "TextBlock",
                        "text": body.message
                    }
                    ]
                }
                }
            ]
        });

        console.log(`[INFO]: statusCode: ${response.status}`);
        //console.log(response.data);
    } catch (error) {
        console.error('[ERROR]: Error sending message to Microsoft Teams:', error);
    }
}