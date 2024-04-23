const axios = require('axios');

/**
 * Attaches large payloads to a Slack file attachment to bypass
 * Slack message character limitations and Pulse console.log
 * length limitations. Requires constants "SlackToken" and "SlackChannelID".
 *
 * Trigger name: SlackAttachmentEvent
 * Call source: other Pulse Actions via emitEvent()
 * Payload example: any text payload
 * Constants example:
 *  SlackToken: xoxp-3649058275-479536623220-742802261858-etcetcetcetcetcetc
 *  SlackChannelID: GFT63D000
 * Outputs:
 * - The text object in the payload will be sent to a configured Slack webhook
 * Prerequisites: configured token and channel for Slack
 * External documentation: https://api.slack.com/docs/message-attachments
 */

exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    try {
        const response = await axios.post('https://slack.com/api/files.upload', {
            token: constants.SlackToken,
            title: 'payload.json',
            filename: 'payload.json',
            filetype: 'javascript',
            channels: constants.SlackChannelID,
            content: JSON.stringify(body)
        });

        console.log(`[INFO]: statusCode: ${response.status}`);
        //console.error(response.data);
    } catch (error) {
        console.error('[ERROR]: Error uploading file to Slack:', error);
    }
};
