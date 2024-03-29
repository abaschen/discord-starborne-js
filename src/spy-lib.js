import _ from 'lodash';
import numeral from 'numeral';
import Discord from "discord.js";

import {levenshteinDistance, Ship, Fleet, baseShipStats, modifiers, BUILDING_STATS} from './lib'

const MARKER_HEADER = 'HEADER';
const MARKER_CAPTURE = 'Capture Defense';
const MARKER_STATION_RES = 'Station Resources';
const MARKER_STATION_CARDS = 'Cards';
const MARKER_STATION_LABOR = 'Station Labor';
const MARKER_BUILDINGS = 'Buildings';
const MARKER_QUEUE_BUILDINGS = 'Building Construction Queue';
const MARKER_QUEUE_FLEETS = 'Fleet Construction Queue';
const MARKER_STATION_HIDDEN_RES = 'Station Hidden Resources';
const MARKER_OUTPOSTS = 'Outposts';
const MARKER_FLEETS = 'Fleets';
const MARKER_HANGAR = 'Hangar';

function Report() {
    this[MARKER_HEADER] = {};
    this[MARKER_CAPTURE] = {};
    this[MARKER_STATION_RES] = {};
    this[MARKER_STATION_CARDS] = [];
    this[MARKER_STATION_LABOR] = null;
    this[MARKER_BUILDINGS] = {};
    this[MARKER_QUEUE_BUILDINGS] = [];
    this[MARKER_QUEUE_FLEETS] = [];
    this[MARKER_STATION_HIDDEN_RES] = {};
    this[MARKER_OUTPOSTS] = {};
    this[MARKER_FLEETS] = [];
    this[MARKER_HANGAR] = [];
    this.failedReport = false;
}

export const MARKERS = {
    MARKER_HEADER,
    MARKER_CAPTURE,
    MARKER_STATION_RES,
    MARKER_STATION_CARDS,
    MARKER_STATION_LABOR,
    MARKER_BUILDINGS,
    MARKER_QUEUE_BUILDINGS,
    MARKER_QUEUE_FLEETS,
    MARKER_STATION_HIDDEN_RES,
    MARKER_OUTPOSTS,
    MARKER_FLEETS,
    MARKER_HANGAR
};
const shipTypes = [
    'Heavy Scout',
    'Patrol Ship',
    'Corvette',
    'Scout', 'Industrial',
    'Destroyer', 'Frigate',
    'Recon', 'Gunship',
    'Troop Carrier',
    'Carrier', 'Dreadnought'
]
const SHIP_TYPES_LEN = shipTypes.length;

function normalizeShipType(type) {
    let dist = 1000;
    let closest = 10000;
    let i = 0;
    let selected = null;
    while (dist > 2 && i < SHIP_TYPES_LEN) {
        dist = levenshteinDistance(type, shipTypes[i]);
        if (dist < closest) {
            selected = shipTypes[i];
            closest = dist;
        } else if (dist < 2 && closest === dist) {
            console.error("ambiguous " + type);
            return type;
        }
        i++;
    }
    if (closest > 4) {
        console.error("very ambiguous" + type);
        return type;
    }
    return selected;
}

const REGEX_HEADER = /^\((?<x>-?\d+)[\s,+]+(?<y>-?\d+)\)\s+(?<name>.+)$/i;
const REGEX_STATION_RES = /(?<res>\w+)\s(?<val>\d+)\s*/gi;
const REGEX_LABOR = /^Labor\s(\w+)$/i;
const REGEX_FLEET = /^(?<qty>\d+)\s(?<type>[a-z\s]+\w)(?<noCards> - No cards\.)?\s?(?<fromPlayer>From\splayerProfile\()?(?<player>[\w\s\d]*)\)?.*/i;
const REGEX_HANGAR = /^[a-z\s]*\((?<type>[a-z\s]+)\)\s(?<qty>\d+)/i;
const REGEX_CARD = /cardTooltip\((\d+)\)\s([\w\s\-']+)/i;

function parseCards(line) {
    return _.chain(line.split(',')).map((card) => {
        try {
            const [, cardId, name] = card.match(REGEX_CARD);
            return {cardId, name, modifiers};
        } catch {
            return null;
        }
    }).filter(_.isNotNull)
        .value();
}

const PARSERS = {
    [MARKER_HEADER]: lines => {
        const header = lines[0].substring(18).split(' completed')[0].match(REGEX_HEADER).groups;
        return {
            name: header.name,
            x: parseInt(header.x, 10),
            y: parseInt(header.y, 10)
        };
    },
    [MARKER_CAPTURE]: line => {
        const cap = _.map(line.split(':')[1].trim().split('/'), s => parseInt(s, 10));
        return {current: cap[0], total: cap[1]};
    },
    [MARKER_STATION_RES]: lines => {
        const regex = lines[0].matchAll(REGEX_STATION_RES);
        const r = {};
        if (!regex) return null;
        for (let result of regex) {
            r[result.groups.res] = parseInt(result.groups.val, 10);
        }
        return r;
    },
    [MARKER_STATION_CARDS]: ([line]) => {
        return parseCards(line.substring(0, line.length - 1));
    },
    [MARKER_STATION_LABOR]: lines => {
        try {
            if (!lines || lines.length < 1 || lines [0].trim() === 'None') {
                return false;
            }
            return parseInt(lines[0].match(REGEX_LABOR)[1], 10);
        } catch (e) {
            return false;
        }
    },
    [MARKER_BUILDINGS]: lines => {
        return lines.length === 0 || lines[0].startsWith('None') ? null : _
            .chain(lines)
            .filter(_.isNotNull)
            .map(l => l.split(' - '))
            .filter(_.isNotNull)
            .map(o => {
                // console.log(o);
                const levelString = o[1].substring(6).trim();
                const building = modifiers.buildings[o[0].trim()] || {name: o[0].trim(), tier: 1, type: 'building'};
                let level;
                if(levelString.startsWith('unknown')){
                   level = false;
                    // console.log('found building', building);
                    return ({
                        name: o[0],
                        tier: building.tier,
                        level,
                        hp: BUILDING_STATS[building.type || 'building'][building.tier - 1][0].hp
                    });
                }else {
                    level = parseInt(levelString, 10);


                    // console.log('found building', building);
                    return ({
                        name: o[0],
                        tier: building.tier,
                        level,
                        hp: BUILDING_STATS[building.type || 'building'][building.tier - 1][Math.min(level - 1, 9)].hp
                    });
                }
            })
            .value();
    },
    [MARKER_QUEUE_BUILDINGS]: lines => {
        return lines;
    },
    [MARKER_QUEUE_FLEETS]: lines => {
        return lines;
    },
    // [MARKER_STATION_HIDDEN_RES]: lines => {
    //
    // },
    [MARKER_FLEETS]: (lines) => {
        let supplied = undefined;
        const firstLine = lines[0];
        let i = 0;
        if (firstLine.trim().endsWith('are supplied by this station')) {
            supplied = parseInt(firstLine.split(' ')[0], 10);
            i++;
        } else if (firstLine.startsWith('None')) {
            return {
                fleets: []
            };
        }

        let fleets = [];
        let info;
        const totalLines = lines.length;
        for (; i < totalLines; i++) {
            const l = lines[i];
            // console.log(l);
            try {
                if (l === null || l.trim() === '') {
                } else {
                    // console.log(l);
                    const match = l.match(REGEX_FLEET);
                    if (match !== null) {
                        const grps = match.groups;
                        // console.log(grps);
                        const qty = parseInt(grps.qty, 10);
                        const type = normalizeShipType(grps.type);
                        const ship = baseShipStats[type];
                        let fromPlayer = null;
                        let cards = null;
                        try {
                            if (!grps.noCards && i + 1 < totalLines) {
                                const nextLine = lines[i + 1];
                                if (nextLine.startsWith('Cards:')) {
                                    cards = parseCards(nextLine.substring(7, lines[i + 1].length - 1));
                                    // console.log('found cards: ',cards);
                                    //skiping nextline
                                    i++;

                                    if (!grps.player && i + 1 < totalLines) {
                                        // from player is onthe next line
                                        const playerMatchLine = lines[i + 1].match(/^From playerProfile\(([\d\w\s]+)\)/);
                                        if (playerMatchLine) {
                                            // console.log('matching ', playerMatchLine)
                                            fromPlayer = playerMatchLine.length > 1 && playerMatchLine[1];
                                            i++;
                                        }
                                    }
                                }
                            }
                            if (grps.noCards && grps.player) {
                                console.error(grps.player);
                                fromPlayer = grps.player;
                            }
                        } catch (e) {
                            info = 'Cannot read cards';
                            console.error(lines[i], e);
                        }
                        // console.log(`adding fleet of ${qty} ${type}`);
                        fleets.push(new Fleet(ship, qty, cards, 0, fromPlayer));
                    }
                }
            } catch (eregex) {
                console.error('fleet line parse error', eregex);
            }
        }

        return {
            supplied,
            fleets
        }
    }
    ,
    [MARKER_HANGAR]:
        lines =>
            _.chain(lines)
                .map(l => {
                    return l.startsWith('None') ? null : l.match(REGEX_HANGAR).groups
                })
                .filter(_.isNotNull)
                .map(({qty, type}) => ({qty: parseInt(qty, 10), type: normalizeShipType(type)}))
                .value(),
    [MARKER_OUTPOSTS]: lines => {
        return lines.length === 0 || lines[0].startsWith('None') ? null : _
            .chain(lines)
            .filter(_.isNotNull)
            .map(l => l.split(' - '))
            .filter(_.isNotNull)
            .map(o => {
                // console.log(o);
                const building = modifiers.outposts[o[0].trim()];
                const levelString = o[1].substring(6).trim();

                if(levelString.startsWith('??')){
                    // console.log('found building', building);
                    return ({
                        name: o[0],
                        tier: building.tier,
                        level: false,
                        hp: BUILDING_STATS[building.type || 'building'][building.tier - 1][0].hp
                    });
                }

                const level = parseInt(levelString, 10);
                const hp = BUILDING_STATS[building.type || 'outpost'][building.tier - 1][level - 1].hp;
                if (o.length > 2) {
                    const op = o[2];

                    return {
                        name: o[0],
                        tier: building.tier,
                        hp: BUILDING_STATS.outpost[building.tier - 1][level - 1].hp,
                        level,
                        operational: op.startsWith('Operational'),
                        boosted: op.substring(11).trim().length > 0
                    }
                }
                return ({
                    name: o[0],
                    tier: building.tier,
                    level,
                    hp
                });
            })
            .value();
    }
}
// same parsers
PARSERS[MARKER_STATION_HIDDEN_RES] = PARSERS[MARKER_STATION_RES];

// privates

function parseSpyReport(raw) {
    const lines = raw.split('\n');
    let marker = MARKER_HEADER;
    const byMarkers = {[MARKER_HEADER]: []};
    try {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.endsWith(':')) {
                // new marker, process last marker
                if (marker != null) {
                    // console.debug('processing ' + marker, byMarkers[marker]);
                    byMarkers[marker] = PARSERS[marker](byMarkers[marker]);
                }
                if (line === 'Construction Queues:') {
                    //skip
                    marker = null;
                } else {
                    marker = line.substring(0, line.length - 1);
                    // console.debug('New marker ' + marker);
                    byMarkers[marker] = [];
                }
            } else if (line.startsWith(MARKER_CAPTURE)) {
                byMarkers[MARKER_CAPTURE] = PARSERS[MARKER_CAPTURE](line);
            } else {
                if(i> lines.length-3 && line.startsWith('Could not get')){
                    byMarkers.failedReport = true;
                }else {
                    if (line !== '')
                        byMarkers[marker].push(line.trim());
                }
            }
        }
        if (marker != null) {
            // console.debug('processing ' + marker, byMarkers[marker]);
            byMarkers[marker] = PARSERS[marker](byMarkers[marker]);
        }
    } catch (e) {
        console.error(`Marker ${marker} failed to process`, e)
    }

    return {
        ...new Report(),
        ..._.chain(byMarkers)
            .mapValues()
            .value()
    };
}

function getFirepower(modifier, level) {
    return modifier && _.isNumber(modifier.firepower) ? modifier.firepower * level : 0;
}

function defaultFormatNumber(n) {
    return _.isNumber(n) ? numeral(n).format('0,0') : '?';
}

function formatHpNumber(n) {
    return numeral(n).format('0,0').padStart(10, ' ');
}

function formatFirepowerNumber(n) {
    return numeral(n).format('0,0').padStart(10, ' ');
}

const TEMPLATE_FLEETS_H1 = `__Fleets:__\`` + String().padStart(22, ' ') + '`';

function getFormattedReport({
                                [MARKER_HEADER]: {name, x, y},
                                [MARKER_CAPTURE]: {current, total},
                                [MARKER_STATION_RES]: {Metal: metal, Gas: gas, Crystal: crystal},
                                [MARKER_STATION_HIDDEN_RES]: {Metal: hiddenMetal, Gas: hiddenGas, Crystal: hiddenCrystal},
                                [MARKER_STATION_CARDS]: stationCards,
                                [MARKER_STATION_LABOR]: labor,
                                [MARKER_BUILDINGS]: buildings,
                                [MARKER_QUEUE_BUILDINGS]: buildingQueue,
                                [MARKER_QUEUE_FLEETS]: fleetQueue,
                                [MARKER_OUTPOSTS]: outposts,
                                [MARKER_FLEETS]: {fleets, supplied},
                                [MARKER_HANGAR]: hangar,
                                failedReport
                            }) {
    const fleetsDesc = _.invokeMap(fleets, 'get');
    // console.log(fleetsDesc);
    const totalBuildingHp = _.reduce(buildings,
        (result, {hp}, name) => result + hp, 0);
    // console.log(outposts);
    const [totalOutpostFirepower, totalOutpostHp] = _.reduce(outposts,
        (result, {hp, name, level}) =>
            [result[0] + getFirepower(modifiers.outposts[name], level), result[1] + hp], [0, 0]);
    const [totalFirepower, totalHp, totalBombing] = _.reduce(fleetsDesc,
        (result, {firepower, hp, bombing}) => [result[0] + firepower, result[1] + hp, result[2] + bombing], [0, 0, 0]);
    // console.log(buildingQueue);
    // console.log(fleetQueue);
    return `=== __**${name}**__ ===================\`/goto ${x} ${y}\`
:shield:  **${current}/${total}**:black_small_square::purple_square: ${defaultFormatNumber(metal)} | ${defaultFormatNumber(hiddenMetal)}:black_small_square::large_blue_diamond: ${defaultFormatNumber(gas)} | ${defaultFormatNumber(hiddenGas)}:black_small_square::green_square: ${defaultFormatNumber(crystal)} | ${defaultFormatNumber(hiddenCrystal)}:black_small_square::construction_worker: **${labor || 'None'}**
Cards:  ${_.map(stationCards, 'name').join(',')}

__Buildings:__ \`${formatHpNumber(totalBuildingHp).padStart(7, ' ')}\`:hearts:
${_.map(buildings, ({level: bLevel, name: bName}) =>
            `**${bLevel || '?'}** ${bName}`).join('\n') || '*empty*'
        }

__Outposts:__
${
            _.map(outposts, ({level: bLevel, operational: bOpe, boosted, hp, name: bName}) =>
                `${bOpe ? ':white_check_mark: ' : ':zzz: '}${boosted ? ':arrow_double_up:' : ':black_small_square:'}\`${formatHpNumber(hp)}\` :hearts: **${bLevel || '?'}** ${bName}`
            ).join('\n') || '*empty*'
        }

${TEMPLATE_FLEETS_H1} \`${formatFirepowerNumber(totalFirepower)} \`:boom: | \`${formatHpNumber(totalHp)} \`:hearts: | \`${formatFirepowerNumber(totalBombing)} \`:skull: `
        + (supplied ? ` | **${supplied}** supplied` : '')
        + '\n' + _.map(fleetsDesc,
            ({hp, firepower, bombing, qty, cards, fromPlayer, ship: {type}}) =>
                `\`${String(qty).padStart(5)}\` x \`${type.padStart(20)}\` \`${formatFirepowerNumber(firepower)} \`:black_small_square: | \`${formatHpNumber(hp)} \`:black_small_square: `
                + `| \`${formatFirepowerNumber(bombing || 0)} \`:black_small_square:`
                + (fromPlayer ? `From: \`${fromPlayer}\`` : '')
                + (cards && cards.length > 0 ? ':card_box: ||' + _.map(cards, c => c.name.substring(0, 15)
                //c => c.shortname || _.map(c.name.split(' '), namePart => namePart.substr(0,3)).join('')
                ).join(', ') + `||` : '')
        ).join('\n')
        + `\n__Hangar:__\n`
        + (_.map(hangar, ({qty, type}) => `${qty} x ${type}`
        ).join('\n') || '*empty*')

        + (buildingQueue && buildingQueue.length>0 ? `\n\n__Building Construction Queue:__\n${buildingQueue.join('\n')}` : '')
        + (fleetQueue && fleetQueue.length>0? `\n\n__Fleet Construction Queue:__\n${fleetQueue.join('\n')}` : '')
        + (failedReport ? `\`\`\`diff
- Spy report not reliable, your spy strength is lower than target spy defense.
\`\`\``: '');
}


export default {
    PARSERS,
    normalizeShipType,
    parseSpyReport,
    getFormattedReport
};