// teams.mjs — who the teams ARE (320 on 2026-10-09; 640 once four more cars arrived the next day).
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
// that fly them. Ten cars in every paddock carry one (the second row of each flag's names came with the second four cars).

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
  // the BMW GT3 paddock: the big coupé. Heavy things, workshop things, and everything a steward can show you
  m4: ['Kraftwerk Nord Racing', 'Bassline Motorsport', 'Subwoofer Squad', 'Kidney Grille Gang', 'Autobahn Athletic', 'Stammtisch Racing', 'Hammerwerk', 'Panzerknacker Racing', 'Techno Viking Motorsport',
    'Doppelkupplung', 'Turbolader Racing', 'Vollgas Verein', 'Überholspur', 'Lichthupe Racing', 'Dicke Karre Motorsport', 'Six Inline Six', 'Straight Six Syndicate', 'Big Coupé Energy', 'Long Bonnet Club',
    'Heavyweight Division', 'Bruiser Racing', 'Sledgehammer GT', 'Wrecking Ball Works', 'Battering Ram Racing', 'Juggernaut Motorsport', 'Mammoth GT', 'Rhino Charge Racing', 'Bison Motorsport', 'Grizzly GT',
    'Ox Cart Racing', 'Bulldozer Squadra', 'Freight Train Racing', 'Tugboat Motorsport', 'Anvil Racing', 'Cast Iron Corse', 'Girder GT', 'Rivet Racing', 'Forge & Furnace', 'Smelter Motorsport',
    'Crankshaft Collective', 'Camshaft Racing', 'Piston Heads Racing', 'Gasket Case Motorsport', 'Torque Wrench Racing', 'Socket Set Squadra', 'Ratchet Racing', 'Breaker Bar GT', 'Dyno Day Racing',
    'Boost Leak Motorsport', 'Wastegate Racing', 'Intercooler Club', 'Launch Control Racing', 'Limiter Bashers', 'Flat Shift Racing', 'Paddle Pullers', 'Kerb Hoppers', 'Sausage Kerb Racing',
    'Track Limits Motorsport', 'Five Second Penalty', 'Drive Through Racing', 'Black & Orange Flag', 'Full Course Yellow', 'Safety Car Restart', 'Green Flag Racing', 'Slipstream Society', 'Tow Rope Racing',
    'Dirty Air Motorsport', 'Marbles Racing', 'Lock-Up Racing', 'Blue Flag Blues', 'Chequered Past Racing', 'Jump Start Motorsport'],
  // the 992 GT3 R paddock: gentlemen drivers. Somebody's money, somebody's harbour, somebody's lunch
  p992: ['Riviera Gentlemen Racing', 'Casino Square Racing', 'Port Hercule Racing', 'Yacht Club Corse', 'Chronograph Racing', 'Tourbillon GT', 'Cufflink Motorsport', 'Signet Ring Racing', 'Old Money Motorsport',
    'Trust Fund Racing', 'Hedge Fund Heroes', 'Quarterly Earnings GT', 'Bull Market Racing', 'Bear Market Motorsport', 'Dividend Racing', 'Venture Capital Corse', 'Angel Investor GT', 'Corner Office Racing',
    'Boardroom Brawlers', 'Golf Was Boring Racing', 'Midlife Crisis Motorsport', 'Second Mortgage Racing', 'Dentist & Dentist', 'Orthodontist Racing', 'Tax Write-Off Racing', 'Expense Account Motorsport',
    'Business Class Racing', 'Private Jet Set', 'Helipad Racing', 'Ski Chalet Corse', 'Après Ski Racing', 'St. Moritz Motor Club', 'Gstaad GT', 'Lake Como Racing', 'Portofino Squadra', 'Amalfi Motorsport',
    'Capri Blue Racing', 'Saint-Tropez Speed', 'Cap Ferrat Racing', 'Marbella Motorsport', 'Ibiza Sunrise Racing', 'Mykonos GT', 'Santorini Squadra', 'Bosphorus Racing', 'Dubai Marina Motorsport',
    'Pearl Coast Racing', 'Bahia Racing', 'Copacabana Corse', 'Punta del Este GT', 'Biscayne Racing', 'Palm Drive Motorsport', 'Rodeo Drive Racing', 'Mulholland GT', 'Pacific Coast Racing', 'Laguna Blanca',
    'Big Sur Racing', 'Napa Valley Motorsport', 'Aspen Racing Club', 'Hamptons GT', "Martha's Vineyard Racing", 'Nantucket Motorsport', 'Savile Row Racing', 'Mayfair Motor Club', 'Belgravia GT',
    'Knightsbridge Racing', 'Caviar Racing', 'Truffle Hunters GT', 'Oyster Bar Racing', 'Lobster Roll Motorsport', 'Silver Spoon Racing', 'Valet Parking GT', 'Concierge Corse'],
  // the Huracán GT3 paddock: Italy, at full volume, and then lunch
  hura: ['Scuderia Fulmine', 'Squadra Tuono', 'Toro Scatenato', 'Corsa Selvaggia', 'Vulcano Racing', 'Etna Corse', 'Stromboli Squadra', 'Scuderia Cinghiale', 'Lupo Nero Racing', 'Aquila Rossa',
    'Falco Pellegrino Corse', 'Vespa Arrabbiata', 'Scuderia Mezzanotte', 'Notte Bianca Racing', 'Alba Corse', 'Tramonto GT', 'Scuderia Gelato', 'Tiramisù Racing', 'Cannoli Corse', 'Espresso Doppio',
    'Ristretto Racing', 'Cappuccino Dopo Le Undici', 'Carbonara Corse', 'Cacio e Pepe Racing', 'Amatriciana Squadra', 'Pesto Genovese GT', 'Ragù Racing', 'Lasagna Squadra', 'Risotto Racing', 'Gnocchi GT',
    'Focaccia Corse', 'Mozzarella Motorsport', 'Parmigiano Racing', 'Panettone Racing', 'Biscotti Corse', 'Granita Squadra', 'Aranciata GT', 'Chinotto Racing', 'Mamma Mia Motorsport', 'Nonna Knows Best',
    'Allora Racing', 'Basta Così', 'Andiamo Corse', 'Forza Tutti', 'Piano Piano Racing', 'Presto Prestissimo', 'Fortissimo GT', 'Crescendo Corse', 'Opera Buffa Racing', 'La Scala Squadra', 'Tenore Racing',
    'Soprano Speed', 'Commedia Corse', 'Arlecchino Racing', 'Pulcinella GT', 'Gondola Racing', 'Rialto Corse', 'Trastevere Racing', 'Colosseo GT', 'Navigli Squadra', 'Via Emilia Racing',
    'Autostrada del Sole', 'Tangenziale Racing', 'Passo Stelvio GT', 'Dolomiti Corse', 'Lago Maggiore Racing', 'Cinque Terre Racing', 'Costa Smeralda GT', 'Neon Toro', 'Wedge Shape Works',
    'Scissor Door Society', 'V10 Choir'],
  // the grand prix paddock: constructors with a motorhome, and everything the pit wall has ever said on the radio
  f122: ['Halcyon Grand Prix', 'Meridian F1 Team', 'Vellum Racing', 'Aster Grand Prix', 'Calder Formula', 'Ostrava GP', 'Lindqvist Racing', 'Marlowe Grand Prix', 'Tessera F1', 'Sorrel Racing',
    'Kestrel Grand Prix', 'Altamira Formula', 'Flanders GP', 'Okuda Racing', 'Santoro Grand Prix', 'Whitlock Formula', 'Varga GP', 'Delacroix Racing', 'Montclair Grand Prix', 'Hartwell F1',
    'Ashdown Racing', 'Pemberton Grand Prix', 'Wind Tunnel Wizards', 'Ground Effect Grand Prix', 'Porpoise Racing', 'Budget Cap Racing', 'Halo Grand Prix', 'Monocoque Motorsport', 'Carbon Tub Racing',
    'Push Rod Racing', 'Pull Rod Grand Prix', 'Diffuser Dynamics', 'Venturi Tunnel GP', 'Sidepod Society', 'Zero Pod Racing', 'Bargeboard Racing', 'Beam Wing GP', 'Plank Wear Racing',
    'Skid Block Grand Prix', 'Tyre Blanket Racing', 'Out Lap Grand Prix', 'In Lap Racing', 'Box Box Racing', 'Undercut Grand Prix', 'Overcut Racing', 'Plan B Grand Prix', 'Plan F Racing',
    'Strat Mode Seven', 'Lift And Coast GP', 'Brake Magic Racing', 'Diff Entry Racing', 'Pole Position GP', 'Lights Out Racing', 'Fastest Lap Grand Prix', 'Driver Of The Day', 'Radio Check Racing',
    'Leave Me Alone GP', 'Smooth Operator Racing', 'Paddock Club Racing', 'Motorhome Grand Prix', 'Silly Season Racing', 'Reserve Driver GP', 'Sim Driver Racing', 'Friday Practice Racing',
    'Sprint Shootout GP', 'Formation Lap Racing', 'Grid Walk Grand Prix', 'Warm-Up Lap', 'Blistering Pace GP', 'Graining Racing', 'Flat Spot Grand Prix', 'DRS Train Racing'],
  // the BMW GT4 paddock: America on a club weekend. The car came on a trailer behind the family truck
  m4g4: ['Lone Star Racing', 'Route 66 Motorsport', 'Tailgate Racing', 'Drive-Thru Motorsport', 'Waffle Stop Racing', 'Corn Dog Corse', 'Funnel Cake Racing', 'Biscuits & Gravy', 'Sweet Tea Speed', 'Gas Station Sushi', 'Truck Stop Racing', 'Mile Marker Motorsport', 'Interstate Racing', 'Cloverleaf GT', 'Rest Area Racing', 'Strip Mall Motorsport', 'Parking Lot Heroes', 'Cul-de-Sac Racing', 'Lawn Chair Racing', 'Garage Band GT', 'Pickup Line Racing', 'Yard Sale Motorsport', 'Swap Meet Speed', 'Bowling Night Racing', 'Little League Legends', 'Homecoming Racing', 'Prom Night GT', 'Varsity Motorsport', 'Marching Band Racing', 'Friday Night Lights Out', 'Spelling Bee Racing', 'Science Fair GT', 'Snow Day Motorsport', 'Summer Break Racing', 'Lemonade Stand', 'Paper Route Racing', 'Treehouse Motorsport', 'Skate Park Racing', 'Arcade Token GT', 'Quarter Machine', 'Pinball Wizards', 'Mini Golf Motorsport', 'Go-Kart Graduates', 'Rental Kart Legends', 'Track Day Bros', 'Autocross Anonymous', 'Cone Killers', 'Time Attack Tuesday', 'Lunch Break Laps', 'Weekend Warriors GT', 'Red-Eye Flight Racing', 'Carry-On Motorsport', 'Road Trip Racing', 'Are We There Yet', 'Shotgun Seat Racing', 'Mixtape Motorsport', 'Windows Down Racing', 'Fuzzy Dice GT', 'Bumper Sticker Racing', 'Air Freshener Motorsport', 'Cup Holder Racing', 'Check Engine Light', 'Low Fuel Warning', 'Oil Change Overdue', 'Jumper Cable Racing', 'Spare Tire Motorsport', 'Duct Tape & Zip Ties', 'Elbow Grease Racing', 'Hand-Me-Down Racing', 'First Car Motorsport', 'Learner Permit Racing', 'Student Driver GT'],
  // the AMG GT4 paddock: the animal kingdom, quick ones and odd ones
  amg4: ['Honey Badger Racing', 'Otter Motorsport', 'Capybara Corse', 'Red Panda Racing', 'Axolotl GT', 'Pangolin Motorsport', 'Quokka Racing', 'Narwhal GT', 'Platypus Racing', 'Wombat Works', 'Tapir Motorsport', 'Lemur Racing', 'Meerkat Motorsport', 'Ocelot GT', 'Lynx Racing', 'Caracal Corse', 'Serval Speed', 'Cougar Country Racing', 'Jackrabbit Racing', 'Roadrunner Motorsport', 'Whippet Racing', 'Swift Motorsport', 'Peregrine GT', 'Osprey Racing', 'Heron Motorsport', 'Kingfisher Racing', 'Magpie Motorsport', 'Puffin Racing', 'Albatross GT', 'Gannet Racing', 'Cormorant Corse', 'Mako Racing', 'Barracuda GT', 'Marlin Motorsport', 'Manta Racing', 'Orca Motorsport', 'Dolphin Kick Racing', 'Seahorse Squadra', 'Hermit Crab Racing', 'Pistol Shrimp GT', 'Cuttlefish Corse', 'Octopus Garden Racing', 'Jellyfish Motorsport', 'Firefly Racing', 'Dragonfly GT', 'Bumblebee Motorsport', 'Ladybird Racing', 'Stag Beetle Squadra', 'Hornet Racing', 'Cicada Motorsport', 'Gecko GT', 'Chameleon Racing', 'Iguana Motorsport', 'Komodo Corse', 'Tortoise & Hare Racing', 'Snapping Turtle GT', 'Bullfrog Racing', 'Salamander Motorsport', 'Newt Racing', 'Hedgehog GT', 'Stoat Racing', 'Pine Marten Motorsport', 'Wolverine GT', 'Moose Crossing Racing', 'Caribou Corse', 'Yak Racing', 'Alpaca Motorsport', 'Llama Drama Racing', 'Goat Path GT', 'Ibex Racing', 'Chamois Motorsport', 'Greyhound GT'],
  // the 499P paddock: Italian works teams, named for stones, metals, maps and the words on a pit board
  f499: ['Amaranto Endurance', 'Vermiglio Works', 'Cremisi Hypercar', 'Porpora Prototype', 'Zafferano Racing', 'Granato Works', 'Rubino Endurance', 'Smeraldo Prototype', 'Zaffiro Racing', 'Topazio Works', 'Ametista Hypercar', 'Opale Endurance', 'Giada Racing', 'Corallo Works', 'Ambra Prototype', 'Perla Nera Endurance', 'Diamante Grezzo', 'Platino Works', 'Titanio Racing', 'Tungsteno Prototype', 'Iridio Endurance', 'Palladio Works', 'Rame Racing', 'Bronzo Hypercar', 'Ottone Works', 'Acciaio Endurance', 'Ferro Battuto Racing', 'Mercurio Prototype', 'Longitudine Zero', 'Equatore Endurance', 'Tropico Works', 'Emisfero Racing', 'Bussola Prototype', 'Sestante Racing', 'Astrolabio Works', 'Cartografia Endurance', 'Rosa dei Venti', 'Portolano Racing', 'Sei Ore Racing', 'Dodici Ore Works', 'Mezzogiorno Endurance', 'Crepuscolo Prototype', 'Ora Blu Racing', 'Ultimo Giro Works', 'Primo Stint', 'Doppio Stint Endurance', 'Bandiera a Scacchi', 'Giro Veloce Racing', 'Curva Parabolica', 'Variante Alta Works', 'Rettifilo Racing', 'Sopraelevata Endurance', 'Tornante Prototype', 'Chicane Works', 'Cordolo Racing', 'Via di Fuga', 'Traguardo Endurance', 'Griglia di Partenza', 'Muretto Box Racing', 'Semaforo Verde', 'Bollino Rosso Works', 'Fuori Giri Racing', 'Limitatore Endurance', 'Coppia Massima', 'Cavalli Vapore Works', 'Ibrido Racing', 'Recupero Energia', 'Frenata Rigenerativa', 'Trazione Integrale Works', 'Carbonio Racing', 'Galleria del Vento', 'Effetto Suolo Prototype', 'Deportanza Works'],
  // the A110 GT4 paddock: France. Lunch is two hours and nobody apologises
  a110: ['Écurie Baguette', 'Croissant Corse', 'Pain au Chocolat Racing', 'Chocolatine Racing', 'Équipe Fromage', 'Camembert Compétition', 'Roquefort Racing', 'Comté Course', 'Raclette Rallye', 'Fondue Formule', 'Tartiflette Team', 'Ratatouille Racing', 'Crêpe Suzette Sport', 'Galette Complète', 'Quiche Lorraine Racing', 'Cassoulet Compétition', 'Bouillabaisse Racing', 'Tarte Tatin Team', 'Mille-Feuille Motorsport', 'Éclair Racing', 'Macaron Motorsport', 'Madeleine Racing', 'Profiterole Sport', 'Crème Brûlée Course', 'Flan Pâtissier', 'Brioche Racing', 'Jambon-Beurre', 'Croque-Monsieur Racing', 'Steak-Frites Sport', 'Moules-Frites Motorsport', 'Escargot Rapide', 'Grenouille Racing', 'Coq au Vin Racing', 'Petit Prince Racing', 'Mousquetaires Motorsport', 'Sans-Culottes Racing', 'Belle Époque Sport', 'Art Nouveau Racing', 'Rive Gauche Racing', 'Montmartre Motorsport', 'Bastille Racing', 'Périphérique Racing', 'Métro Boulot Dodo', 'Rond-Point Racing', 'Priorité à Droite', 'Deux Chevaux Racing', 'Quatre-Vingt-Dix-Neuf', 'Zut Alors Racing', 'Oh Là Là Motorsport', 'Bof Racing', 'Voilà Sport', "C'est La Vie Racing", 'Je Ne Sais Quoi', 'Déjà Vu Racing', 'Rendez-Vous Racing', 'Faux Pas Motorsport', 'Bon Voyage Racing', 'Bonne Chance Sport', 'Au Revoir Racing', 'À Bientôt Motorsport', 'Grève Générale', 'Pause Café Racing', 'Goûter Racing', 'Sieste Sport', 'Vacances Racing', 'Col du Galibier', 'Col du Tourmalet', "Alpe d'Huez Racing", 'Gorges du Verdon', "Côte d'Azur Racing", 'Bretagne Racing', 'Normandie Motorsport', 'Savoie Sport', 'Auvergne Racing', 'Dieppe Bleu'],
  // the 9X8 paddock: the future, as the car with no rear wing imagines it. Physics, deep space and a computer that has crashed
  p9x8: ['Wingless Works', 'No Wing No Problem', 'Cyberia Endurance', 'Chrome Dawn Racing', 'Synthwave Works', 'Laser Grid Racing', 'Vaporwave Endurance', 'Retrofuture Prototype', 'Year 3000 Racing', 'Warp Factor Works', 'Hyperspace Endurance', 'Light Speed Racing', 'Singularity Works', 'Wormhole Racing', 'Dark Matter Endurance', 'Antimatter Prototype', 'Tachyon Racing', 'Photon Works', 'Neutrino Endurance', 'Quark Racing', 'Boson Prototype', 'Plasma Works', 'Fusion Reactor Racing', 'Tokamak Endurance', 'Ion Drive Works', 'Solar Sail Racing', 'Orbital Ring Endurance', 'Space Elevator Works', 'Moonbase Racing', 'Mars Colony Endurance', 'Europa Prototype', 'Ganymede Works', 'Callisto Racing', 'Enceladus Endurance', 'Triton Prototype', 'Kuiper Belt Racing', 'Oort Cloud Works', 'Heliopause Endurance', 'Voyager Racing', 'Pathfinder Prototype', 'Sputnik Works', 'Cosmonaut Racing', 'Astronaut Ice Cream', 'Zero Gravity Endurance', 'Free Fall Racing', 'Escape Velocity Works', 'Slingshot Endurance', 'Lagrange Point Racing', 'Apogee Prototype', 'Perigee Works', 'Parallax Racing', 'Redshift Endurance', 'Blueshift Works', 'Doppler Racing', 'Pulsar Prototype', 'Magnetar Works', 'Red Giant Racing', 'White Dwarf Endurance', 'Binary Star Works', 'Hologram Racing', 'Android Dreams Endurance', 'Robot Uprising Racing', 'Mainframe Works', 'Motherboard Prototype', 'Overclock Racing', 'Firmware Endurance', 'Kernel Panic Works', 'Stack Overflow Racing', 'Blue Screen Endurance', 'Ctrl Alt Defeat', '404 Grip Not Found', 'Lag Spike Racing', 'Frame Drop Works', 'Respawn Endurance', 'Speedrun Prototype', 'Final Boss Racing', 'New Game Plus'],
};
// A team named for the company that pays for it: the company, and one of these, each used once.
export const TAILS = ['Works', 'Squadra Corse', 'Junior Team', 'Speed Shop', 'Race Lab', 'Factory Racing', 'Performance Centre', 'Skunkworks', 'Racing Division', 'Motor Club', 'Grand Prix Team',
  'Competition Department', 'Rennsport', 'Autosport', 'Racing Collective', 'Pit Crew', 'Sprint Team', 'Endurance Squad', 'Garage', 'Racing Society', 'Track Club', 'Motorsport'];

// ---- pride ------------------------------------------------------------------------------------
// cols top to bottom as the flag is flown; w = each stripe's share (default equal)
export const PRIDE = [
  { key: 'rainbow', label: 'Rainbow', cols: ['e40303', 'ff8c00', 'ffed00', '008026', '004dff', '750787'],
    teams: ['Full Spectrum Racing', 'Over The Rainbow GT', 'Out & Proud Motorsport', 'Loud & Proud Racing',
      'Every Colour Corse', 'Rainbow Road Racing', 'Pride Parade Motorsport', 'Technicolour GT',
      'Roy G. Biv Racing', 'After The Rain GT', 'Six Stripes Motorsport', 'Prism Break Racing'] },
  { key: 'trans', label: 'Trans', cols: ['5bcefa', 'f5a9b8', 'ffffff', 'f5a9b8', '5bcefa'],
    teams: ['Transmission Racing', 'Shift Happens GT', 'Trans Rights Rennsport', 'Blue Pink White Works',
      'Trans Am Racing', 'True Colours Rennsport', 'Manual Transition Motorsport', 'Becoming Racing',
      'Transcontinental Racing', 'Egg Cracked GT', 'New Name Same Speed', 'Girl Dinner Grand Prix'] },
  { key: 'bi', label: 'Bi', cols: ['d60270', '9b4f96', '0038a8'], w: [2, 1, 2],
    teams: ['Bi-Turbo Racing', 'Bi The Way GT', 'Both Lanes Motorsport', 'Bi-Plane Endurance',
      'Bi-Directional Racing', 'Bi-Xenon GT', 'Bilingual Racing', 'Why Not Both Racing',
      'Bi-Focal Racing', 'Bi-Coastal Motorsport', 'Double Take GT', 'Plot Twist Racing'] },
  { key: 'lesbian', label: 'Lesbian', cols: ['d52d00', 'ff9a56', 'ffffff', 'd362a4', 'a30262'],
    teams: ['Sapphic Speed Works', 'Sappho Squadra', 'Girls Like Girls GT', 'Sunset Sapphics Racing',
      'Girlfriends Grand Prix', 'Lavender Menace Racing', 'She & Her Racing', 'Violet Hour GT',
      'Useless Lesbian Racing', 'Cottagecore Corse', 'Flannel Motorsport', 'Carabiner Club GT'] },
  { key: 'pan', label: 'Pan', cols: ['ff218c', 'ffd800', '21b1ff'],
    teams: ['Panoramic Racing', 'Hearts Not Parts Motorsport', 'Pan Global GT', 'Pancake Stack Racing',
      'Pandemonium Racing', 'All Hearts Motorsport', 'Pansexual Panthers', 'Frying Pan GT',
      'Peter Pan Am Racing', 'Pan Pizza Motorsport', 'Whole Menu GT', 'Panorama Point Racing'] },
  { key: 'nonbinary', label: 'Non-binary', cols: ['fcf434', 'ffffff', '9c59d1', '2c2c2c'],
    teams: ['They/Them Motorsport', 'Enby Endurance', 'Outside The Binary GT', 'Neither Nor Racing',
      'Third Option Racing', 'Enby Envy GT', 'Beyond Binary Works', 'Them Fatale Racing',
      'They Did That Racing', 'Mx. Motorsport', 'Enbious GT', 'Both And Neither Works'] },
  { key: 'ace', label: 'Ace', cols: ['0e0f12', 'a3a3a3', 'ffffff', '800080'],
    teams: ['Ace Of Pace Racing', 'Garlic Bread Racing', 'Cake Over Everything GT', 'Aces High Autosport',
      'Ace In The Hole GT', 'Four Aces Racing', 'Space Ace Motorsport', 'Dragons & Cake Racing',
      'Ace Attorney GT', 'Pocket Aces Racing', 'Aced It Motorsport', 'Black Ring Racing'] },
  { key: 'mlm', label: 'Gay men', cols: ['078d70', '98e8c1', 'ffffff', '7bade2', '3d1a78'],
    teams: ['Achilles Heel-and-Toe Racing', 'Patroclus Performance', 'Boys Like Boys GT', 'Husbands Racing',
      'Boyfriends Racing', 'Vincian Speed Works', 'Two Grooms GT', 'Him & Him Motorsport',
      'Golden Retriever Boyfriends', 'Sword & Shield GT', 'Two Kings Racing', 'Mr & Mr Motorsport'] },
  { key: 'genderfluid', label: 'Genderfluid', cols: ['ff75a2', 'ffffff', 'be18d6', '0e0f12', '333ebd'],
    teams: ['Fluid Dynamics GT', 'Go With The Flow Racing', 'Shapeshifter Squadra', 'Ebb & Flow Endurance',
      'Tidal Shift Racing', 'Ever Changing GT', 'Mercury Rising Racing', 'Fluid Motion Works',
      'Shape Of Water Racing', 'Changeable GT', 'Liquid State Motorsport', 'Phase Shift Racing'] },
  { key: 'progress', label: 'Progress', cols: ['e40303', 'ff8c00', 'ffed00', '008026', '004dff', '750787'], chevron: ['0e0f12', '613915', '5bcefa', 'f5a9b8', 'ffffff'],
    teams: ['Progress Autosport', 'Forward Together Racing', 'Everybody In Motorsport', 'Room For All Racing',
      'Onward Racing', 'No One Left Behind GT', 'Bigger Table Motorsport', 'Chevron Forward Racing',
      'Keep Going Racing', 'More Colours More Speed', 'Open Door GT', 'Next Chapter Motorsport'] },
  { key: 'aro', label: 'Aro', cols: ['3da542', 'a7d379', 'ffffff', 'a9a9a9', '0e0f12'],
    teams: ['Aro Dynamics', 'Platonic Performance', 'No Romance Just Racing', 'Just Friends Motorsport',
      'Aro Ace Aero', 'Arrow Aro Racing', 'Squish Not Crush GT', 'Best Friends Forever Racing',
      'Aromantic Aerodynamics', 'Green Arrow GT', 'Friendship Is Fast', 'Solo Stint Racing'] },
  { key: 'intersex', label: 'Intersex', cols: ['ffd800'], ring: '7902aa',
    teams: ['Full Circle Racing', 'Purple Ring Works', 'Whole As We Are GT', 'Unbroken Circle Endurance',
      'Perfect Circle GT', 'Golden Field Racing', 'Born This Way Motorsport', 'Ring Of Purple Racing',
      'Yellow & Purple Racing', 'Complete Circle Works', 'As Nature Made GT', 'Round Trip Motorsport'] },
  { key: 'genderqueer', label: 'Genderqueer', cols: ['b57edc', 'ffffff', '4a8123'],
    teams: ['Genderqueer Garage', 'Lavender & Green Racing', 'Queer Gear Motorsport', 'Rules Optional Racing',
      'Queer Joy Racing', 'Gender Outlaws GT', 'Unlabelled Motorsport', 'Lavender Fields Racing',
      'Queer As In Fast', 'Chartreuse Corse', 'Odd One Out GT', 'Off Script Racing'] },
  { key: 'agender', label: 'Agender', cols: ['0e0f12', 'bcc4c7', 'ffffff', 'b7f684', 'ffffff', 'bcc4c7', '0e0f12'],
    teams: ['No Gender Only Speed', 'Agender Agenda GT', 'Gender? Never Heard Of It Racing', 'Just A Driver Motorsport',
      'Null Pointer Racing', 'Gender Not Found GT', 'Blank Space Racing', 'None Of The Above Motorsport',
      'Void Motorsport', 'Undefined Racing', 'Opt Out GT', 'Zero Genders Seven Gears'] },
];

// ---- the actual grid ----------------------------------------------------------------------------
// Adam, 2026-10-10, looking at the grand prix car in the garage: "add the acc f1 teams lol".
// The eleven teams of the 2026 season and their twenty-two drivers, in each team's own colours.
// A name, a number and paint: no maker's badge and no real sponsor is drawn (the sticker sheet has
// only the invented ones, and these cars carry none of those either). They come FIRST in the car's list.
// cols: body, graphic, accent, dark.  fin: 0 gloss · 1 matte · 2 metallic
const T = (team, design, cols, fin, rim, ...drivers) => drivers.map(([driver, num]) => ({ name: `${team} — ${driver}`, team, num, design, cols, fin, rim }));
export const REAL = {
  f122: [
    ...T('McLaren', 'SWEEP', ['ff8000', '15161a', '47c7fc', '15161a'], 0, '15161a', ['Norris', 1], ['Piastri', 81]),
    ...T('Scuderia Ferrari', 'PINSTRIPE', ['e8002d', 'f4f3ee', 'ffeb00', '15161a'], 0, '15161a', ['Leclerc', 16], ['Hamilton', 44]),
    ...T('Red Bull Racing', 'WAVE', ['121f45', 'e30118', 'ffc906', '0b1430'], 1, '15161a', ['Verstappen', 3], ['Hadjar', 6]),
    ...T('Mercedes', 'FADE', ['c8ccce', '15161a', '00d7b6', '15161a'], 2, '15161a', ['Russell', 63], ['Antonelli', 12]),
    ...T('Aston Martin', 'TWIN STRIPE', ['00594f', 'cedc00', 'f4f3ee', '0e0f12'], 2, '15161a', ['Alonso', 14], ['Stroll', 18]),
    ...T('Alpine', 'HALF AND HALF', ['0078c1', 'ff87bc', 'f4f3ee', '0e0f12'], 0, '15161a', ['Gasly', 10], ['Colapinto', 43]),
    ...T('Williams', 'SPEEDFORM', ['00205b', '00a0de', 'f4f3ee', '0e0f12'], 0, '15161a', ['Albon', 23], ['Sainz', 55]),
    ...T('Racing Bulls', 'ARROW', ['f4f3ee', '1634cb', 'e30118', '15161a'], 0, 'f4f3ee', ['Lawson', 30], ['Lindblad', 41]),
    ...T('Haas', 'BLOCK', ['f4f3ee', '15161a', 'e6002b', '15161a'], 0, '15161a', ['Ocon', 31], ['Bearman', 87]),
    ...T('Audi', 'HALFTONE', ['b9bdc0', '15161a', 'f50537', '15161a'], 2, '15161a', ['Hülkenberg', 27], ['Bortoleto', 5]),
    ...T('Cadillac', 'TWO-FACE', ['f4f3ee', '0e0f12', '8a8d8f', '0e0f12'], 0, '15161a', ['Pérez', 11], ['Bottas', 77]),
  ],
};
