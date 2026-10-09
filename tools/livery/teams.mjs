// teams.mjs — who the 320 teams ARE.
//
// Adam, 2026-10-09: "make sur everyone grts a unique name, bc these are js
// gnerated by random cool name from list + random motorsport name from list".
// He was right: the first names were a prefix and a suffix drawn from two hats,
// so there was an Obsidian GT and an Obsidian Autosport on the same grid.
// Every name here is written out, once, for one team. No root is used twice
// anywhere in the four paddocks.
//
// And: "ADD PRIDE FLAG CARS THATD BE SO COOL TO SEE AS ONE FROM THAT
// COMMUNITY ... make their names have smth to do with their sexuality".
// PRIDE at the bottom: fourteen flags in their real colours, and the teams
// that fly them. Ten cars in every paddock carry one.

// The four he picked out by name keep their name, their place and their paint.
export const KEEP = { 'm720:2': 'Apex Union Endurance', 'm720:6': 'Donut District Motorsport', 'm720:13': 'Hyperion Corse', 'm720:14': 'Maison Vero GT' };

export const NAMES = {
  // the 911 cup paddock: German club racing, and a lap of the Nordschleife's corner names
  p911: ['Nordkurve Rennsport', 'Eifelblitz', 'Team Sturmvogel', 'Kranich & Co.', 'Zuffenwerk 64', 'Schwarzwald Racing', 'Rheingold Rennstall', 'Adlerhorst', 'Bergkönig Motorsport',
    'Hafenstadt Racing', 'Kaiserstuhl Cup Team', 'Edelweiss Speed', 'Donauwelle', 'Steinadler RS', 'Blitzableiter', 'Falkenflug', 'Nordsee Racing Crew', 'Tannhäuser Tor', 'Vogelfrei Motorsport',
    'Wolff & Sohn', 'Zeppelin Garage', 'Morgenrot Racing', 'Silberfuchs', 'Uhlenhorst Racing Club', 'Elbflorenz', 'Feuerbach Tuning', 'Grünwald Rennteam', 'Isarflimmern', 'Jägerschnitzel Racing',
    'Kugelblitz', 'Air-Cooled Legends', 'Heckmotor Heroes', 'Boxer Rebellion', 'Flat Six Society', 'Ducktail Racing', 'Whale Tail Works', 'Küstenwind Racing', 'Linke Spur Racing', 'Rastplatz Rockets',
    'Currywurst Corse', 'Bratwurst Brigade', 'Pretzel Logic Racing', 'Kuckucksuhr', 'Lederhosen Laptime', 'Schnitzel Sprint', 'Apfelschorle Racing', 'Feierabend Racing', 'Stau Racing Team',
    'Blaulicht', 'Grüne Hölle Gang', 'Karussell Kids', 'Brünnchen Boys', 'Schwalbenschwanz Racing', 'Pflanzgarten Flyers', 'Döttinger Höhe', 'Hatzenbach', 'Flugplatz Racing', 'Bergwerk Motorsport',
    'Eschbach', 'Quiddelbacher', 'Adenauer Forst', 'Metzgesfeld', 'Kallenhard', 'Wehrseifen', 'Ex-Mühle', 'Klostertal', 'Hohe Acht', 'Wippermann', 'Eiskurve', 'Galgenkopf', 'Hohenrain', 'Tiergarten Racing'],
  // the McLaren GT3 paddock: professional outfits with expensive names
  m720: ['Vanta Black Racing', 'Helix Motorsport', 'Apex Union Endurance', 'Paragon Squadra', 'Monarch GT', 'Donut District Motorsport', 'Cobalt Line', 'Ignis Corse', 'Vector Autosport', 'Strato Racing',
    'Zenith Endurance', 'Hyperion Corse', 'Maison Vero GT', 'Halberd GT', 'Solaris Squadra', 'Obsidian Racing', 'Tempest Autosport', 'Aurum Corse', 'Kinetic GT Team', 'Nova Racing Lab', 'Raptor Motorsport',
    'Citadel Endurance', 'Blackbird GT', 'Corsair Racing', 'Delta Nine', 'Emissary Motorsport', 'Foxhound Racing', 'Gryphon Squadra', 'Icarus Racing', 'Javelin GT', 'Kite Motorsport', 'Lumen Racing',
    'Mantis Autosport', 'Northstar Endurance', 'Onyx Corse', 'Phantom Ray', 'Quasar GT', 'Redline Syndicate', 'Sable Racing', 'Talon Motorsport', 'Umbra GT', 'Wyvern Racing', 'Xenon Autosport',
    'Yardstick Racing', 'Zero Kelvin', 'Arclight', 'Basilisk GT', 'Cinder Racing', 'Driftwood Motorsport', 'Ember & Ash', 'Flux Racing', 'Glasswing', 'Harbinger GT', 'Ironclad Racing', 'Jetstream Autosport',
    'Keystone Corse', 'Lodestar', 'Maelstrom Racing', 'Nightjar GT', 'Outlier Racing', 'Pinnacle Squadra', 'Quicksilver', 'Riptide Racing', 'Stormglass', 'Thunderhead GT', 'Undertow Racing', 'Vantage Point',
    'Whiplash Motorsport', 'Second Sector', 'Late Braker Club', 'Purple Sector Racing', 'Parc Fermé'],
  // the Ginetta GT4 paddock: British privateers, a trailer, a gazebo and a flask
  g55: ['Thistle Racing', 'Pennine Motorsport', 'Cotswold Motor Club', 'Fenland Flyers', 'Mersey Beat Racing', 'Tyne & Wear & Tear', 'Severn Bore Racing', 'Wessex Wheelers', 'Biscuit Tin Racing',
    'Dad & Lad Motorsport', 'Shed Eleven', 'Two Brews Racing', 'Rain Stopped Play', 'Gravel Trap Heroes', "Kev's Garage", 'Team Bodge', 'Flat Cap Racing', 'Chip Shop Racing', 'Soggy Bottom Motorsport',
    'Proper Job Racing', 'Last Orders', 'Wellington Boot Racing', 'Sunday Roast Racing', 'Mind The Gap', 'Jolly Good Racing', 'Tea Break Motorsport', 'Garden Shed Racing', 'Brolly Racing', 'Crumpet Corse',
    'Bank Holiday Racing', 'Hedgerow Racing', 'Pork Pie Motorsport', 'Marmalade Racing', 'Zebra Crossing Racing Club', 'Double Decker Racing', 'Sausage Roll Racing', 'Full English Motorsport',
    "Builder's Tea Racing", 'Roundabout Racing', 'Queue Politely', 'Sorry Mate Racing', 'Bit Nippy Motorsport', "Mustn't Grumble", 'Cheeky Overtake', "Nan's Sunday Best", 'Car Boot Sale Racing',
    'Wonky Trolley', 'Lollipop Lady Racing', 'Fish Supper Racing', 'Bobble Hat Racing', 'Custard Cream Corse', 'Jammy Dodger Racing', 'Scotch Egg Squadra', 'Yorkshire Pud Racing', 'Cornish Pasty Motorsport',
    'Welsh Rarebit Racing', 'Haggis Hunters', 'Black Pudding Racing', 'Bakewell Tart Racing', 'Eccles Cake Racing', "Ploughman's Lunch", 'Toad In The Hole', 'Bubble & Squeak', 'Stargazy Pie',
    'Lardy Cake Racing', 'Pie & Mash Motorsport', 'Bangers & Mash Racing', 'Knickerbocker Glory', 'Sticky Toffee Racing', 'Gravy Boat Racing', 'Mushy Peas Motorsport', 'Curry Sauce Corse'],
  // the Alpine hypercar paddock: works teams, and the night at Le Mans
  a480: ['Aurore Hypercar', 'Mistral Endurance', 'Tramontane Racing', 'Kumo Works', 'Hayate Prototype', 'Raijin Factory', 'Solstice Le Mans', 'Borealis Endurance', 'Vostok Works', 'Titan Prototype',
    'Helios Racing', 'Écurie Lumière', 'Scuderia Volpe', 'Équipe Vingt-Quatre', 'Sirocco Sport', 'Polaris Works', 'Meteor Endurance', 'Corona Australis Racing', 'Tsunami Factory', 'Ventoux Racing',
    'Zephyr Hypercar', 'Arcadia Endurance', 'Bifrost Works', 'Calypso Racing', 'Daedalus Prototype', 'Elysium Endurance', 'Fenrir Factory', 'Galatea Racing', 'Horizon Works', 'Ionosphere', 'Juno Hypercar',
    'Krakatoa Racing', 'Leviathan Endurance', 'Midnight Sun Racing', 'Nebula Works', 'Orion Prototype', 'Perihelion', 'Quetzal Racing', 'Rubicon Endurance', 'Shogun Works', 'Tundra Hypercar',
    'Ultramarine Racing', 'Vesuvius Works', 'Wanderlust Endurance', 'Xanadu Racing', 'Yukon Prototype', 'Zodiac Works', 'Twenty-Four Hours Later', 'Mulsanne Straight Racing', 'Dawn Patrol Endurance',
    'Triple Stint Racing', 'Night Shift Works', 'Golden Hour Racing', 'Hour Twenty-Three', 'Tertre Rouge Racing', 'Arnage Works', 'Maison Blanche Racing', 'Chapelle Racing', 'Karting-Est Works',
    'Raccordement', 'Hunaudières Hypercar', 'Sarthe & Sons', 'Rillettes Racing', 'Garage 56 Experiment', 'Sleepless Endurance', 'Stint Five', 'Caffeine & Carbon', 'One More Lap Works', 'Sunrise Stint',
    'The Long Night Racing', 'Pit Wall Prophets', 'Fuel Window Racing'],
};
// A team named for the company that pays for it: the company, and one of these, each used once.
export const TAILS = ['Works', 'Squadra Corse', 'Junior Team', 'Speed Shop', 'Race Lab', 'Factory Racing', 'Performance Centre', 'Skunkworks', 'Racing Division', 'Motor Club', 'Grand Prix Team',
  'Competition Department', 'Rennsport', 'Autosport', 'Racing Collective', 'Pit Crew', 'Sprint Team', 'Endurance Squad', 'Garage', 'Racing Society', 'Track Club', 'Motorsport'];

// ---- pride ------------------------------------------------------------------------------------
// cols top to bottom as the flag is flown; w = each stripe's share (default equal)
export const PRIDE = [
  { key: 'rainbow', label: 'Rainbow', cols: ['e40303', 'ff8c00', 'ffed00', '008026', '004dff', '750787'],
    teams: ['Full Spectrum Racing', 'Over The Rainbow GT', 'Out & Proud Motorsport', 'Loud & Proud Racing'] },
  { key: 'trans', label: 'Trans', cols: ['5bcefa', 'f5a9b8', 'ffffff', 'f5a9b8', '5bcefa'],
    teams: ['Transmission Racing', 'Shift Happens GT', 'Trans Rights Rennsport', 'Blue Pink White Works'] },
  { key: 'bi', label: 'Bi', cols: ['d60270', '9b4f96', '0038a8'], w: [2, 1, 2],
    teams: ['Bi-Turbo Racing', 'Bi The Way GT', 'Both Lanes Motorsport', 'Bi-Plane Endurance'] },
  { key: 'lesbian', label: 'Lesbian', cols: ['d52d00', 'ff9a56', 'ffffff', 'd362a4', 'a30262'],
    teams: ['Sapphic Speed Works', 'Sappho Squadra', 'Girls Like Girls GT', 'Sunset Sapphics Racing'] },
  { key: 'pan', label: 'Pan', cols: ['ff218c', 'ffd800', '21b1ff'],
    teams: ['Panoramic Racing', 'Hearts Not Parts Motorsport', 'Pan Global GT', 'Pancake Stack Racing'] },
  { key: 'nonbinary', label: 'Non-binary', cols: ['fcf434', 'ffffff', '9c59d1', '2c2c2c'],
    teams: ['They/Them Motorsport', 'Enby Endurance', 'Outside The Binary GT', 'Neither Nor Racing'] },
  { key: 'ace', label: 'Ace', cols: ['0e0f12', 'a3a3a3', 'ffffff', '800080'],
    teams: ['Ace Of Pace Racing', 'Garlic Bread Racing', 'Cake Over Everything GT', 'Aces High Autosport'] },
  { key: 'mlm', label: 'Gay men', cols: ['078d70', '98e8c1', 'ffffff', '7bade2', '3d1a78'],
    teams: ['Achilles Heel-and-Toe Racing', 'Patroclus Performance', 'Boys Like Boys GT', 'Husbands Racing'] },
  { key: 'genderfluid', label: 'Genderfluid', cols: ['ff75a2', 'ffffff', 'be18d6', '0e0f12', '333ebd'],
    teams: ['Fluid Dynamics GT', 'Go With The Flow Racing', 'Shapeshifter Squadra', 'Ebb & Flow Endurance'] },
  { key: 'progress', label: 'Progress', cols: ['e40303', 'ff8c00', 'ffed00', '008026', '004dff', '750787'], chevron: ['0e0f12', '613915', '5bcefa', 'f5a9b8', 'ffffff'],
    teams: ['Progress Autosport', 'Forward Together Racing', 'Everybody In Motorsport', 'Room For All Racing'] },
  { key: 'aro', label: 'Aro', cols: ['3da542', 'a7d379', 'ffffff', 'a9a9a9', '0e0f12'],
    teams: ['Aro Dynamics', 'Platonic Performance', 'No Romance Just Racing', 'Just Friends Motorsport'] },
  { key: 'intersex', label: 'Intersex', cols: ['ffd800'], ring: '7902aa',
    teams: ['Full Circle Racing', 'Purple Ring Works', 'Whole As We Are GT', 'Unbroken Circle Endurance'] },
  { key: 'genderqueer', label: 'Genderqueer', cols: ['b57edc', 'ffffff', '4a8123'],
    teams: ['Genderqueer Garage', 'Lavender & Green Racing', 'Queer Gear Motorsport', 'Rules Optional Racing'] },
  { key: 'agender', label: 'Agender', cols: ['0e0f12', 'bcc4c7', 'ffffff', 'b7f684', 'ffffff', 'bcc4c7', '0e0f12'],
    teams: ['No Gender Only Speed', 'Agender Agenda GT', 'Gender? Never Heard Of It Racing', 'Just A Driver Motorsport'] },
];
