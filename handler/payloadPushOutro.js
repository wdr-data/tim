const request = require('request');
const urls = require('../lib/urls');

const pushOutro = (chat, payload) => {
    request(`${urls.push(payload.push)}`, (error, res, body) => {
        const push = JSON.parse(body);

        if (push.media) {
            chat.sendAttachment(push.media).then(() => {
                chat.sendText(push.outro);
            }).catch(error => {
                console.log('Sending outro media failed', error)
            });
            return;
        }

        chat.sendText(push.outro);
    });
};

module.exports = pushOutro;
