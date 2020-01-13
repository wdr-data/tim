import request from 'request-promise-native';
import moment from 'moment-timezone';

import urls from '../lib/urls';
import { buttonPostback, genericElement } from '../lib/facebook';

export const newsAbout = async (chat, payload) => {
    const baseParams = {
        withFragments: 1,
        limit: 10,
    };

    let qs;

    try {
        qs = { ...baseParams, ...await searchId(payload) };
    } catch (e) {
        return chat.sendText(`Dazu habe ich leider keine Info...🤔`);
    }

    const report = await request({
        uri: urls.reports,
        json: true,
        qs,
    });

    if (report.length === 0) {
        return chat.sendText(`Dazu habe ich leider keine Info...🤔`);
    }

    const elements = [];
    report.forEach((r) => {
        const buttons = [];
        const reportDate = moment(r.created)
            .tz('Europe/Berlin')
            .format('DD.MM.YYYY');
        if (r.audio) {
            buttons.push(
                buttonPostback(
                    'Jetzt anhören 🎧',
                    {
                        action: 'report_audio',
                        audioUrl: r.audio,
                        category: 'chat-report',
                        event: `report-${r.headline}`,
                        label: 'audio',
                    }

                ));
        }
        buttons.push(
            buttonPostback('Lesen 📰',
                {
                    action: 'report_start',
                    report: r.id,
                    type: 'report',
                    category: 'chat-report',
                    event: `report-${r.headline}`,
                    label: 'intro',
                }));

        elements.push(
            genericElement(
                `${reportDate} - ${r.headline}`,
                r.text,
                buttons
            )
        );
    });

    if (chat.trackingEnabled) {
        if (payload.tags.stringValue) {
            await chat.track.event(
                'chat-report',
                'tags',
                payload.tags.stringValue,
            ).send();
        }
        if (payload.genres.stringValue) {
            await chat.track.event(
                'chat-report',
                'genres',
                payload.genres.stringValue,
            ).send();
        }
    }

    return chat.sendGenericTemplate(elements.slice(0, 10));
};

export const searchId = async (payload) => {
    /* Resolves a tag or genre from dialogflow-result string to ID, with priority to genres */
    const searchParameter = [ 'genres', 'tags' ];
    const map = {
        genres: 'genres',
        tags: 'tags',
    };

    for (const key of searchParameter) {
        if (payload[key].stringValue === '') {
            continue;
        }

        const data = await request({
            uri: urls[key](payload[key].stringValue),
            json: true,
        });

        if (data.length === 0) {
            continue;
        }
        return {
            [map[key]]: data[0].id,
        };
    }

    throw Error();
};
