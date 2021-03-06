import { v4 as uuidv4 } from 'uuid';
import path from 'path';

import rp from 'request-promise-native';

import { getAttachmentId } from './facebookAttachments';
import DynamoDbCrud from './dynamodbCrud';
import Webtrekk from './webtrekk';

export class Chat {
    constructor(event) {
        this.event = event;
        this.psid = event.sender.id;

        this.subscribed = undefined;
        this.subscriptions = undefined;

        this.feedbackMode = undefined;

        this.track = undefined;
        this.trackingEnabled = undefined;
        this.uuid = undefined;
    }

    async loadSettings() {
        try {
            const subscriptions = new DynamoDbCrud(process.env.DYNAMODB_SUBSCRIPTIONS, 'psid');
            const sub = await subscriptions.load(this.psid);
            this.subscribed = sub.morning || sub.evening || sub.breaking;
            this.subscriptions = sub;
        } catch (e) {
            this.subscribed = false;
        }

        try {
            const userStates = new DynamoDbCrud(
                process.env.DYNAMODB_USERSTATES,
                'psid'
            );
            const states = await userStates.load(this.psid);
            if (states.surveyTime &&
                states.surveyTime + 7*24*60*60 > Math.floor(Date.now() / 1000)) {
                this.surveyMode = true;
                console.log('Survey mode enabled.');
            } else {
                this.surveyMode = false;
            }
            if (states.feedbackTime &&
                states.feedbackTime + 1*60*60 > Math.floor(Date.now() / 1000)) {
                this.feedbackMode = true;
                console.log('Feedback mode enabled.');
            } else {
                this.feedbackMode = false;
            }
        } catch (e) {
            this.surveyMode = false;
            this.feedbackMode = false;
        }

        const users = new DynamoDbCrud(process.env.DYNAMODB_USERS, 'psid');
        const usersItem = await users.load(this.psid);
        if (usersItem) {
            this.uuid = usersItem.uuid;
        } else {
            const uuid = uuidv4();
            await users.create(this.psid, { uuid });
            this.uuid = uuid;
        }

        this.track = async (params) => {};

        try {
            const tracking = new DynamoDbCrud(process.env.DYNAMODB_TRACKING, 'psid');
            this.trackingEnabled = (await tracking.load(this.psid)).enabled;

            if (this.trackingEnabled) {
                this.webtrekk = new Webtrekk(
                    this.uuid,
                );
                this.track = async (params) =>
                    this.webtrekk.track(params);
            }
        } catch (e) {
            console.log('User has not chosen tracking preferences yet.');
        }
    }

    send(payload, options) {
        const { timeout, extra } = options || {};

        payload.recipient = { id: this.psid };

        payload = { ...payload, ...extra };
        if (!payload['messaging_type']) {
            payload['messaging_type'] = 'RESPONSE';
        }

        return rp.post({
            uri: 'https://graph.facebook.com/v6.0/me/messages',
            json: true,
            qs: {
                'access_token': process.env.FB_PAGETOKEN,
            },
            body: payload,
            timeout: timeout || 10000,
        });
    }

    async sendFullNewsBase(newsBaseObj, quickReplies = null, options) {
        const fragments = [ newsBaseObj, ...newsBaseObj.next_fragments || [] ];
        const head = fragments.slice(0, -1);
        const tail = fragments.slice(-1)[0];

        for (const fragment of head) {
            if (fragment.attachment) {
                await this.sendAttachment(fragment.attachment.processed, undefined, options);
            }
            await this.sendText(fragment.text, undefined, options);
        }

        if (tail.attachment) {
            await this.sendAttachment(tail.attachment.processed, undefined, options);
        }
        return this.sendText(tail.text, quickReplies, options);
    }

    async sendFullNewsBaseWithButtons(newsBaseObj, buttons, quickReplies = null, options) {
        const fragments = [ newsBaseObj, ...newsBaseObj.next_fragments || [] ];
        const head = fragments.slice(0, -1);
        const tail = fragments.slice(-1)[0];

        for (const fragment of head) {
            if (fragment.attachment) {
                await this.sendAttachment(fragment.attachment.processed, undefined, options);
            }
            await this.sendText(fragment.text, undefined, options);
        }

        if (tail.attachment) {
            await this.sendAttachment(tail.attachment.processed, undefined, options);
        }
        return this.sendButtons(tail.text, buttons, quickReplies, options);
    }

    sendText(text, quickReplies = null, options) {
        const message = { text: text };
        if (quickReplies !== null && quickReplies.length > 0) {
            message['quick_replies'] = quickReplies;
        }

        const payload = {
            message: message,
        };

        return this.send(payload, options);
    }

    sendButtons(text, buttons, quickReplies = null, options) {
        const message = {
            attachment: {
                type: 'template',
                payload: {
                    'template_type': 'button',
                    text: text,
                    buttons: buttons,
                },
            },
        };
        if (quickReplies !== null && quickReplies.length > 0) {
            message['quick_replies'] = quickReplies;
        }

        const payload = {
            message: message,
        };

        return this.send(payload, options);
    }

    sendGenericTemplate(elements, options) {
        this.sendTemplate(elements, 'generic', options);
    }

    sendTemplate(elements, templateType = 'generic', options) {
        const payload = {
            message: {
                attachment: {
                    type: 'template',
                    payload: {
                        'template_type': templateType,
                        elements: elements,
                    },
                },
            },
        };

        return this.send(payload, options);
    }

    async sendAttachment(url, type = null, options) {
        if (type === null) {
            type = guessAttachmentType(url);
        }

        const attachmentId = await getAttachmentId(url, type);
        console.log(`received ${attachmentId} from getAttachmentId`);

        return this.send({
            message: {
                attachment: {
                    type: type,
                    payload: {
                        'attachment_id': attachmentId,
                    },
                },
            },
        }, options);
    }
}

export function quickReply(title, payload, imageUrl = null) {
    if (typeof payload !== 'string') {
        payload = JSON.stringify(payload);
    }

    const payload_ = {
        'content_type': 'text',
        title: title,
        payload: payload,
    };

    if (imageUrl !== null && imageUrl.length > 0) {
        payload_['image_url'] = imageUrl;
    }

    return payload_;
}

export function buttonPostback(title, payload) {
    if (typeof payload !== 'string') {
        payload = JSON.stringify(payload);
    }

    const payload_ = {
        type: 'postback',
        title: title,
        payload: payload,
    };

    return payload_;
}

export function buttonShare(genericElement = null) {
    const payload = {
        type: 'element_share',
    };

    if (genericElement !== null) {
        payload['share_contents'] = {
            attachment: {
                type: 'template',
                payload: {
                    'template_type': 'generic',
                    elements: genericElement,
                },
            },
        };
    }

    return payload;
}

export function buttonUrl(title, url, webviewHeightRatio = 'full') {
    const payload = {
        type: 'web_url',
        title: title,
        url: url,
        'webview_height_ratio': webviewHeightRatio,
    };

    return payload;
}

export function genericElement(
    title,
    subtitle = null,
    buttons = null,
    imageUrl = null,
    defaultAction = null
) {
    const payload = {
        title: title,
    };

    if (subtitle !== null && subtitle.length > 0) {
        payload.subtitle = subtitle;
    }

    if (imageUrl !== null && imageUrl.length > 0) {
        payload['image_url'] = imageUrl;
    }

    if (defaultAction) {
        payload['default_action'] = defaultAction;
    }

    if (buttons !== null) {
        if (!Array.isArray(buttons)) {
            buttons = [ buttons ];
        }
        if (buttons.length > 0) {
            payload.buttons = buttons;
        }
    }

    return payload;
}

export function guessAttachmentType(filename) {
    // Guesses the attachment type from the file extension
    const ext = path.extname(filename).toLowerCase();
    const types = {
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image',
        '.mp4': 'video',
        '.mp3': 'audio',
    };

    return types[ext] || null;
}
