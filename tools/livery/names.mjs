// names.mjs — what the teams are CALLED, second edition.
//
// Adam, 2026-10-10: "also make the names actual team names that sound real".
// The first edition's names were jokes (Gas Station Sushi, Capybara Corse).
// These read like an entry list: a family name or a place, and Racing,
// Motorsport, Rennsport, Corse, Compétition — the way real outfits are named,
// each paddock from the countries that race that car. Every one is invented
// and written out once; none is a real team's name on purpose.
//
// They fill the ordinary seats of tools/livery/roster.json in order. The seats
// that keep their first-edition names: the ten pride teams in every paddock
// (their names are the point of them — teams.mjs PRIDE), the four liveries
// Adam picked out (keep.json) and the actual grand prix grid (teams.mjs REAL).
// `node tools/livery/names.mjs` writes them into the roster.
import fs from 'fs';

export const NAMES = {
  // Carrera Cup: Germany
  p911: ['Hartung Motorsport', 'Team Brückner Racing', 'Falkenried Rennsport', 'Lindhorst Motorsport', 'Kaltenbach Racing', 'Team Sörensen', 'Weidmann Motorsport', 'Oberland Racing Team', 'Rheinau Motorsport',
    'Krüger & Wolff Racing', 'Team Steinhagen', 'Auerbach Rennsport', 'Hohenfels Racing', 'MSC Altenahr', 'Scuderia Lahntal', 'Bergheim Motorsport', 'Nordhaus Racing', 'Team Zellweger', 'Dornfeld Motorsport',
    'Petersen Engineering', 'Vogt Racing Team', 'Lübeck Motorsport', 'Team Eisenach', 'Rademacher Motorsport', 'Kirchhoff Racing', 'Hansa Rennteam', 'Team Albrecht Motorsport', 'Schönborn Racing', 'Wendel Motorsport',
    'Team Ravensburg', 'Bachmann Rennsport', 'Ostwald Racing', 'Team Kronberg', 'Leitner Motorsport', 'Fürstenau Racing', 'Marquardt Motorsport', 'Team Baden Racing', 'Hellwig Rennsport', 'Engelhardt Racing',
    'Team Freyberg', 'Kranz Motorsport', 'Lechtal Racing', 'Sauerland Motorsport', 'Team Thielen', 'Uhlmann Racing', 'Vossberg Motorsport', 'Team Ammersee', 'Brandl Rennsport', 'Castrop Racing Team',
    'Dietrich Motorsport', 'Eifelwerk Racing', 'Team Friesland', 'Gerlach Motorsport', 'Holsten Racing', 'Team Isenburg', 'Jansen & Kreutz', 'Kessler Rennsport', 'Team Lüneburg Racing', 'Meinhardt Motorsport',
    'Neuhaus Racing', 'Team Odenwald', 'Pfalz Motorsport', 'Reinhold Racing', 'Team Spreewald', 'Tannert Motorsport', 'Ullrich Rennsport', 'Team Vogtland', 'Westfalen Racing', 'Zimmermann Motorsport',
    'Team Allgäu Motorsport', 'Bodensee Racing', 'Harz Rennsport'],
  // McLaren GT3: Britain, professional
  m720: ['Ashcombe Racing', 'Team Redgrave', 'Halden Motorsport', 'Kingsway GT', 'Strathmore Racing', 'Blackwater Motorsport', 'Team Carrick', 'Pembroke Racing', 'Northgate Motorsport', 'Alderney GT Racing',
    'Team Lyndhurst', 'Whitmore Autosport', 'Castleford Racing', 'Ravenscroft Motorsport', 'Team Aldridge', 'Marlow Racing', 'Foxley Motorsport', 'Hawkridge GT', 'Team Brannigan', 'Wexford Racing',
    'Silverlake Motorsport', 'Orchard Park Racing', 'Team Fenwick', 'Calder Racing', 'Dunmere Autosport', 'Team Holloway', 'Larkhill Motorsport', 'Team Maddox', 'Norwood GT', 'Oakhurst Racing', 'Team Penhale',
    'Quarry Lane Motorsport', 'Redcliffe Racing', 'Team Sandford', 'Thornbury GT', 'Upton Racing', 'Team Vickery', 'Westbrook Motorsport', 'Yarrow Racing', 'Team Ashby Motorsport', 'Barrowfield GT',
    'Team Coleridge', 'Dalton Park Racing', 'Elmsworth Motorsport', 'Team Fairburn', 'Glenmore Racing', 'Hadleigh GT', 'Team Ingram', 'Jesmond Racing', 'Kirkby Motorsport', 'Team Langford', 'Merrick Racing',
    'Netherby GT', 'Team Osborne Racing', 'Prescott Motorsport', 'Team Rowan', 'Selwyn Racing', 'Tavistock GT', 'Team Underhill', 'Verity Motorsport', 'Wyndham Racing', 'Team Yeoman', 'Ainsley Autosport',
    'Brightwell Racing', 'Team Corbett', 'Drayton GT', 'Easton Motorsport', 'Team Farrow', 'Greystone Racing', 'Hollis Motorsport', 'Team Ivory Racing', 'Stanhope GT'],
  // Ginetta GT4: Britain, club racing
  g55: ['Tidmarsh Racing', 'Team Hobbs Motorsport', 'Ridgeway Race Engineering', 'Marston Motor Racing', 'Kettlewell Racing', 'Team Dobson', 'Applegarth Motorsport', 'Bexley Race Cars', 'Coombe Valley Racing',
    'Team Pickering', 'Lowther Motorsport', 'Hartley Race Preparation', 'Swindale Racing', 'Team Entwistle', 'Fosse Way Motorsport', 'Garside Racing', 'Team Ollerton', 'Wetherby Motorsport',
    'Burnham Race Engineering', 'Team Tunstall', 'Padgate Racing', 'Cheviot Motorsport', 'Team Arkwright', 'Malvern Racing', 'Ormskirk Motorsport', 'Team Bradshaw', 'Lytham Race Team', 'Hexham Racing',
    'Team Clegg Motorsport', 'Saddleworth Racing', 'Tamar Valley Motorsport', 'Team Grimshaw', 'Longridge Racing', 'Brackley Motorsport', 'Team Haworth', 'Ribble Valley Racing', 'Otley Motorsport',
    'Team Postlethwaite', 'Wharfedale Racing', 'Stourbridge Motorsport', 'Team Tattersall', 'Kendal Racing', 'Ludlow Motorsport', 'Team Unsworth', 'Mendip Racing', 'Nantwich Motorsport', 'Team Whittaker',
    'Peak District Racing', 'Rothbury Motorsport', 'Team Yardley', 'Skipton Racing', 'Tewkesbury Motorsport', 'Team Ackroyd', 'Ullswater Racing', 'Wensleydale Motorsport', 'Team Barraclough', 'Alnwick Racing',
    'Bodmin Motorsport', 'Team Cartwright', 'Dartmoor Racing', 'Evesham Motorsport', 'Team Dewhurst', 'Frome Racing', 'Glossop Motorsport', 'Team Eccleston', 'Helmsley Racing', 'Ilkley Motorsport',
    'Team Fothergill', 'Keswick Racing', 'Leominster Motorsport', 'Team Garnett', 'Matlock Racing'],
  // Alpine A480: France and Japan, the works end of the pit lane
  a480: ['Équipe Valmont', 'Ardennes Endurance', 'Team Kisaragi', 'Signal Endurance', 'Écurie Beaumont', 'Tokachi Racing', 'Vaillancourt Compétition', 'Team Shirakawa', 'Lorraine Sport Prototype',
    'Mirabeau Endurance', 'Hokuto Racing Project', 'Écurie Montreuil', 'Delorme Sport', 'Team Asagiri', 'Roussillon Racing', 'Kurosawa Engineering', 'Armor Endurance', 'Écurie Saint-Clair', 'Team Hayabusa Works',
    'Brévent Compétition', 'Nagoya Racing Factory', 'Charente Endurance', 'Team Fontenay', 'Sagami Motorsport', 'Écurie Lavandou', 'Périgord Racing', 'Team Minato', 'Vendôme Sport', 'Kiyosato Racing',
    'Aquitaine Endurance', 'Team Duvernay', 'Yatsugatake Racing', 'Écurie Rochefort', 'Camargue Compétition', 'Team Otsuka Engineering', 'Luberon Racing', 'Fujimi Works', 'Écurie Marchand', 'Team Clairvaux',
    'Tsukuba Racing Project', 'Savigny Endurance', 'Dordogne Sport', 'Team Kirishima', 'Écurie Lambert', 'Gascogne Racing', 'Suzuran Motorsport', 'Team Bellecour', 'Jura Endurance', 'Hamana Racing',
    'Écurie Deschamps', 'Team Montfort', 'Akagi Works', 'Limousin Compétition', 'Vercors Racing', 'Team Nishida', 'Écurie Garnier', 'Morvan Endurance', 'Haruna Racing', 'Team Sauvage', 'Cévennes Sport',
    'Écurie Fournier', 'Myoko Racing Project', 'Team Larivière', 'Picardie Endurance', 'Shigaraki Works', 'Écurie Tessier', 'Team Okabe', 'Vosges Compétition', 'Beaujolais Racing', 'Team Hasegawa',
    'Écurie Renaud', 'Chartreuse Endurance'],
  // BMW M4 GT3: the Low Countries and Scandinavia
  m4: ['Team Vandersmissen', 'Hagenbeck Racing', 'Mertens Motorsport', 'Team Oosterhout', 'Brandenburg Racing', 'Dekker Autosport', 'Team Lindqvist', 'Achterberg Racing', 'Nordström Motorsport', 'Team Verhaegen',
    'Kuipers Racing', 'Sønderby Motorsport', 'Team Hoekstra', 'Wallenius Racing', 'Maastricht Motorsport', 'Team De Clercq', 'Bjørnstad Racing', 'Limburg Autosport', 'Team Jacobsen', 'Ravensberg Racing',
    'Antwerp Racing Team', 'Hallberg Motorsport', 'Team Peeters', 'Skagen Racing', 'Zeeland Motorsport', 'Team Eriksson', 'Veluwe Racing', 'Östergren Motorsport', 'Team Claessens', 'Groningen Racing',
    'Lofoten Motorsport', 'Team Willems', 'Brabant Racing', 'Sundqvist Motorsport', 'Team Maes', 'Kempen Racing', 'Åkesson Motorsport', 'Team Goossens', 'Twente Racing', 'Dalarna Motorsport', 'Team Smets',
    'Flevoland Racing', 'Holmgren Motorsport', 'Team Wouters', 'Hasselt Racing', 'Bergström Motorsport', 'Team Janssens', 'Utrecht Autosport', 'Nyberg Racing', 'Team Lemmens', 'Gelderland Motorsport',
    'Engström Racing', 'Team Hendrickx', 'Leuven Racing', 'Forsberg Motorsport', 'Team Coppens', 'Drenthe Racing', 'Lundgren Motorsport', 'Team Aerts', 'Namur Racing', 'Sjöberg Motorsport', 'Team Bogaerts',
    'Overijssel Racing', 'Viklund Motorsport', 'Team Dierckx', 'Mechelen Racing', 'Hedlund Motorsport', 'Team Geerts', 'Tilburg Autosport', 'Ekberg Racing', 'Team Pauwels', 'Kortrijk Racing'],
  // Porsche 992 GT3 R: Switzerland, Austria, Italy and America, pro-am
  p992: ['Team Zurbriggen', 'Altmann Motorsport', 'Lakeshore Racing', 'Scuderia Brenta', 'Team Hofstetter', 'Summit Point Motorsports', 'Graubünden Racing', 'Team Aschauer', 'Ridgeline Motorsports',
    'Scuderia Valsesia', 'Team Bieri', 'Coastal Range Racing', 'Tirol Motorsport', 'Team Odermatt', 'Black Mesa Racing', 'Scuderia Lomellina', 'Team Wyss', 'Harbor City Motorsports', 'Salzkammergut Racing',
    'Team Gasser', 'Cedar Falls Racing', 'Scuderia Brianza', 'Team Lüthi', 'Great Lakes Motorsports', 'Vorarlberg Racing', 'Team Ammann', 'Iron Mountain Racing', 'Scuderia Valtellina', 'Team Schmid Motorsport',
    'Blue Ridge Racing', 'Steiermark Motorsport', 'Team Kälin', 'Canyon Road Racing', 'Scuderia Franciacorta', 'Team Brunner', 'Bay Area Motorsports', 'Kärnten Racing', 'Team Zaugg', 'Granite State Racing',
    'Scuderia Monferrato', 'Team Roth Motorsport', 'Prairie Wind Racing', 'Engadin Racing', 'Team Imhof', 'Rocky Ford Motorsports', 'Scuderia Garda', 'Team Kunz', 'Pine Barrens Racing', 'Wallis Motorsport',
    'Team Fankhauser', 'Sonoran Motorsports', 'Scuderia Langhe', 'Team Bucher', 'Chesapeake Racing', 'Appenzell Motorsport', 'Team Marti', 'Cascade Motorsports', 'Scuderia Oltrepò', 'Team Huber Racing',
    'Tidewater Racing', 'Thurgau Motorsport', 'Team Aebi', 'Piedmont Motorsports', 'Scuderia Lunigiana', 'Team Stalder', 'High Desert Racing', 'Ticino Corse', 'Team Rüegg', 'Gulf Coast Motorsports',
    'Scuderia Cadore', 'Team Felder', 'Northwoods Racing'],
  // Lamborghini Huracán GT3: Italy
  hura: ['Scuderia Valdarno', 'Team Bonetti', 'Antonioli Motorsport', 'Squadra Rovigo Corse', 'Scuderia Monteverdi', 'Team Lazzarin', 'Castelletto Racing', 'Scuderia Ravenna', 'Team Galimberti', 'Brixia Corse',
    'Scuderia Montalto', 'Team Pedrazzi', 'Lario Motorsport', 'Scuderia Fiorenza', 'Team Zanardelli', 'Vesuvio Corse', 'Scuderia Belmonte', 'Team Morandi', 'Adria Racing', 'Scuderia Cremona', 'Team Bertolotti',
    'Tirreno Motorsport', "Scuderia Sant'Elia", 'Team Carraro', 'Polesine Corse', 'Scuderia Aspromonte', 'Team Fumagalli', 'Etruria Racing', 'Scuderia Maranza', 'Team Giordano', 'Salento Motorsport',
    'Scuderia Valpolicella', 'Team Lombardi', 'Irpinia Corse', 'Scuderia Torrechiara', 'Team Marchetti', 'Maremma Racing', 'Scuderia Belvedere', 'Team Negri', 'Gargano Motorsport', 'Scuderia Castelfranco',
    'Team Orlandi', 'Cilento Corse', 'Scuderia Pontevecchio', 'Team Paganelli', 'Versilia Racing', 'Scuderia Roccaforte', 'Team Rinaldini', 'Barbagia Motorsport', 'Scuderia San Marco', 'Team Sartori',
    'Carso Corse', 'Scuderia Tre Valli', 'Team Tedeschi', 'Molise Racing', 'Scuderia Valleverde', 'Team Vitali', 'Abruzzo Motorsport', 'Scuderia Zanetti', 'Team Zambelli', 'Conero Corse', 'Scuderia Appia',
    'Team Barbieri', 'Sila Racing', 'Scuderia Borgonuovo', 'Team Caruso', 'Trasimeno Motorsport', 'Scuderia Campidoglio', 'Team De Luca', 'Madonie Corse', 'Scuderia Ducale', 'Team Esposito'],
  // the grand prix car: constructors
  f122: ['Halcyon Grand Prix', 'Meridian F1 Team', 'Aster Grand Prix', 'Caldwell Formula', 'Ostrava GP', 'Marlowe Grand Prix', 'Tessera F1 Team', 'Sorrel Racing', 'Altamira Formula', 'Flanders GP', 'Okuda Racing',
    'Santoro Grand Prix', 'Whitlock Formula One', 'Varga GP', 'Delacroix Racing', 'Montclair Grand Prix', 'Hartwell F1 Team', 'Ashdown Racing', 'Pemberton Grand Prix', 'Vellum Racing', 'Lindahl Grand Prix',
    'Arrowsmith Grand Prix', 'Bellamy F1 Team', 'Corvin Racing', 'Davenport Grand Prix', 'Eastwood Formula', 'Fairfax F1 Team', 'Galloway Grand Prix', 'Hargreave Racing', 'Ingleby Grand Prix', 'Jarrow Formula',
    'Kensington GP', 'Lancaster Grand Prix', 'Montague F1 Team', 'Northcote Racing', 'Orsini Grand Prix', 'Petrov Formula', 'Quinlan Racing', 'Rosenthal Grand Prix', 'Stirling Formula', 'Takeda Grand Prix',
    'Underwood F1 Team', 'Valente Racing', 'Wolcott Grand Prix', 'Yamashiro Formula', 'Zeller Grand Prix', 'Albright Racing', 'Brennan Grand Prix', 'Casimir F1 Team', 'Draper Grand Prix', 'Ellery Formula',
    'Fontana Grand Prix', 'Gresham Racing', 'Holbrook F1 Team', 'Ishikawa Grand Prix', 'Jennings Formula', 'Kowalski Grand Prix', 'Lorimer Racing', 'Mallory Grand Prix', 'Novak F1 Team', 'Oxley Grand Prix',
    'Pascoe Formula', 'Radcliffe Grand Prix', 'Sandoval Racing', 'Thackeray Grand Prix', 'Ulrich F1 Team', 'Vasquez Grand Prix', 'Winslow Formula', 'Yelland Grand Prix', 'Zamora Racing', 'Ambrose Grand Prix',
    'Bancroft F1 Team'],
  // BMW M4 GT4: America
  m4g4: ['Stonebridge Motorsports', 'Team Hadley Racing', 'Copperhead Racing', 'Riverbend Motorsports', 'Team Callahan', 'Lone Pine Racing', 'Tri-County Motorsports', 'Team McAllister', 'Red Rock Racing',
    'Lakeview Motorsports', 'Team Delgado Racing', 'Ironwood Motorsports', 'Sawtooth Racing', 'Team Whitaker', 'Bluegrass Motorsports', 'Mesa Verde Racing', "Team O'Rourke", 'Twin Rivers Motorsports',
    'Flatiron Racing', 'Team Castellano', 'Sandhills Motorsports', 'Big Sky Racing', 'Team Brewer Motorsports', 'Hill Country Racing', 'Team Nakamura Racing', 'Palmetto Motorsports', 'Wasatch Racing',
    'Team Kowalczyk', 'Ozark Motorsports', 'Shoreline Racing', 'Team Fitzgerald', 'Cumberland Motorsports', 'Mojave Racing', 'Team Ramirez Motorsports', 'Finger Lakes Racing', 'Bayou Motorsports',
    'Team Stratton', 'Keystone State Racing', 'Front Range Motorsports', 'Team Abernathy', 'Low Country Racing', 'Yellowstone Motorsports', 'Team Gallagher', 'Motor City Racing', 'Elk Grove Motorsports',
    'Team Pruitt', 'Sierra Vista Racing', 'Heartland Motorsports', 'Team Villanueva', 'Olympic Peninsula Racing', 'Old Dominion Motorsports', 'Team Lindstrom', 'Catskill Racing', 'Tallgrass Motorsports',
    'Team Boudreaux', 'Santa Fe Racing', 'High Plains Motorsports', 'Team Yoder', 'Black Hills Racing', 'Savannah River Motorsports', 'Team Mercer', 'Allegheny Racing', 'Three Forks Motorsports',
    'Team Donovan', 'Silver State Racing', 'Bitterroot Motorsports', 'Team Ellison', 'Pioneer Valley Racing', 'North Shore Motorsports', 'Team Carmichael', 'Golden Gate Racing', 'Appalachian Motorsports'],
  // Mercedes-AMG GT4: central Europe and Iberia
  amg4: ['Team Novotný', 'Carpathia Racing', 'Kovács Motorsport', 'Team Wiśniewski', 'Iberia Racing Team', 'Horvat Motorsport', 'Team Dvořák', 'Balaton Racing', 'Petrović Motorsport', 'Team Almeida', 'Tatra Racing',
    'Kamiński Motorsport', 'Team Navarro', 'Danubia Racing', 'Popescu Motorsport', 'Team Ferreira', 'Bohemia Racing', 'Szabó Motorsport', 'Team Castaño', 'Vistula Racing', 'Jovanović Motorsport', 'Team Oliveira',
    'Moravia Racing', 'Nagy Motorsport', 'Team Herrero', 'Adriatic Racing', 'Ionescu Motorsport', 'Team Carvalho', 'Silesia Racing', 'Tóth Motorsport', 'Team Montero', 'Galicia Racing', 'Marković Motorsport',
    'Team Pereira', 'Pannonia Racing', 'Zieliński Motorsport', 'Team Ibáñez', 'Dalmatia Racing', 'Dumitru Motorsport', 'Team Sousa', 'Mazovia Racing', 'Farkas Motorsport', 'Team Aguirre', 'Istria Racing',
    'Nikolić Motorsport', 'Team Teixeira', 'Pomerania Racing', 'Molnár Motorsport', 'Team Beltrán', 'Transylvania Racing', 'Kolář Motorsport', 'Team Cardoso', 'Asturias Racing', 'Wójcik Motorsport',
    'Team Echeverría', 'Slavonia Racing', 'Stoica Motorsport', 'Team Machado', 'Andalucía Racing', 'Pokorný Motorsport', 'Team Zubiri', 'Algarve Racing', 'Kiss Motorsport', 'Team Moreira', 'Cantabria Racing',
    'Babić Motorsport', 'Team Quintana', 'Alentejo Racing', 'Procházka Motorsport', 'Team Lourenço', 'Aragón Racing', 'Balogh Motorsport'],
  // Ferrari 499P: the world championship, entered from everywhere
  f499: ['Team Sterling Endurance', 'Harrowgate Prototype', 'Pacific Crest Racing', 'Team Al-Rashid', 'Meridiana Corse', 'Southern Cross Endurance', 'Team Kwan Racing', 'Northern Lights Racing', 'Arabian Sea Racing',
    'Team Castellari', 'Blackwood Endurance', 'Singapura Racing', 'Team Hargrove', 'Atlas Mountain Racing', 'Kowloon Endurance', 'Team Whitcombe', 'Cape Point Racing', 'Bosphorus Endurance',
    'Team Laurent Sport', 'Tasman Racing', 'Team Mehta Racing', 'Andes Endurance', 'Team Sinclair Prototype', 'Seoul Racing Project', 'Patagonia Endurance', 'Team Okonkwo', 'Baltic Endurance', 'Team Watanabe',
    'Sahara Endurance', 'Team Lefebvre', 'Macau Racing Team', 'Aegean Endurance', 'Team Harrington', 'Atlantic Endurance', 'Team Bianchi Corse', 'Yangtze Racing', 'Highveld Endurance', 'Team Montgomery',
    'Bangkok Racing Project', 'Caspian Endurance', 'Team Fairweather', 'Jakarta Racing', 'Rhine Endurance', 'Team Castellanos', 'Team Al-Farsi', 'Manila Racing Team', 'Dolomite Endurance',
    'Team Thornton Prototype', 'Hanoi Racing', 'Nile Endurance', 'Team Rossetti', 'Perth Racing Project', 'Danube Endurance', 'Team Blackburn', 'Taipei Racing', 'Mekong Endurance', 'Team Sorrentino',
    'Auckland Racing', 'Ganges Endurance', 'Team Kingsley', 'Santiago Racing', 'Zambezi Endurance', 'Team De Angelis', 'Bogotá Racing', 'Indus Endurance', 'Team Winterbourne', 'Lima Racing Project',
    'Volga Endurance', 'Team Marchesi', 'Montevideo Racing', 'Tigris Endurance', 'Team Ashworth'],
  // Alpine A110 GT4: France
  a110: ['Team Chevallier', 'Écurie Montagny', 'Besançon Racing', 'Team Lacroix Compétition', 'Sologne Sport Auto', 'Écurie Vauclair', 'Team Bertrand', 'Annecy Racing', 'Compétition Lemaire', 'Écurie du Vexin',
    'Team Girard', 'Alsace Sport Auto', 'Écurie Perrin', 'Team Moreau Compétition', 'Quercy Racing', 'Écurie Dumont', 'Team Blanchard', 'Roannais Sport', 'Écurie Leroux', 'Team Gauthier', 'Béarn Compétition',
    'Écurie Michaud', 'Team Roussel', 'Touraine Racing', 'Écurie Bonnet', 'Team Chauvin', 'Vivarais Sport Auto', 'Écurie Lemoine', 'Team Barbier', 'Poitou Compétition', 'Écurie Renard', 'Team Collet',
    'Forez Racing', 'Écurie Marchal', 'Team Dupuis', 'Bugey Sport', 'Écurie Vasselin', 'Team Fabre', 'Maurienne Compétition', 'Écurie Noël', 'Team Guillot', 'Berry Racing', 'Écurie Picard', 'Team Hamel',
    'Livradois Sport Auto', 'Écurie Royer', 'Team Jacquet', 'Trégor Compétition', 'Écurie Schmitt', 'Team Klein Sport', 'Diois Racing', 'Écurie Thibault', 'Team Langlois', 'Bigorre Sport', 'Écurie Vidal',
    'Team Maillard', 'Queyras Compétition', 'Écurie Weber', 'Team Normand', 'Minervois Racing', 'Écurie Aubert', 'Team Olivier Sport', 'Comminges Sport Auto', 'Écurie Brunet', 'Team Pasquier',
    'Couserans Compétition', 'Écurie Carpentier', 'Team Roche', 'Larzac Racing', 'Écurie Delmas', 'Team Sabatier', 'Trièves Sport'],
  // Peugeot 9X8: Belgium and Britain
  p9x8: ['Team Vanderhaeghen Endurance', 'Blackfriars Prototype', 'Ostend Racing Team', 'Team Rutherford', 'Liège Endurance', 'Kingsbridge Prototype', 'Team Verstraeten', 'Ardmore Endurance', 'Spa-Malmedy Racing',
    'Team Halloran', 'Ghent Prototype', 'Silverdale Endurance', 'Team Mortier', 'Charleroi Racing', 'Lockwood Prototype', 'Team Vermeulen', 'Hainaut Endurance', 'Ravenhall Prototype', 'Team Lambrecht',
    'Bruges Racing', 'Whitehaven Endurance', 'Team Desmet', 'Walloon Prototype', 'Stanmore Endurance', 'Team Callewaert', 'Mons Racing Team', 'Eastleigh Prototype', 'Team Vandamme', 'Flandria Endurance',
    'Harcourt Prototype', 'Team Bauwens', 'Dinant Racing', 'Kingsdown Endurance', 'Team Roelandt', 'Tournai Prototype', 'Ashbourne Endurance', 'Team Delvaux', 'Waterloo Racing', 'Marchmont Prototype',
    'Team Peirsman', 'Sambre Endurance', 'Thorncliffe Prototype', 'Team Lejeune', 'Meuse Racing', 'Wickham Endurance', 'Team Schoonjans', 'Kempenland Prototype', 'Belgrave Endurance', 'Team Thys',
    'Tongeren Racing', 'Oakmoor Prototype', 'Team Cornelis', 'Leie Endurance', 'Fenchurch Prototype', 'Team Van Acker', 'Scheldt Racing', 'Kingsmead Endurance', 'Team Moens', 'Ypres Prototype',
    'Lowfield Endurance', 'Team De Backer', 'Ourthe Racing', 'Hollingworth Prototype', 'Team Segers', 'Lys Endurance', 'Castlemaine Prototype', 'Team Wauters', 'Semois Racing', 'Brackenhurst Endurance',
    'Team Vervoort', 'Dender Prototype', 'Ellesmere Endurance'],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = new URL('../../', import.meta.url).pathname, file = ROOT + 'tools/livery/roster.json';
  const roster = JSON.parse(fs.readFileSync(file, 'utf8')), keep = JSON.parse(fs.readFileSync(ROOT + 'tools/livery/keep.json', 'utf8'));
  const seen = new Map();
  for (const [key, teams] of Object.entries(roster)) teams.forEach((t, i) => { if (t.pride || t.real || keep[`${key}:${i}`]) seen.set(t.name, key); });
  for (const [key, teams] of Object.entries(roster)) {
    const list = NAMES[key]; let k = 0;
    if (!list) throw new Error(`names: no names for ${key}`);
    teams.forEach((t, i) => {
      if (t.pride || t.real || keep[`${key}:${i}`]) return;
      if (k >= list.length) throw new Error(`names: ${key} needs more than its ${list.length} names`);
      const name = list[k++];
      if (seen.has(name)) throw new Error(`names: two teams are called ${name} (${seen.get(name)} and ${key})`);
      seen.set(name, key); t.name = name;
    });
    console.log(`${key}: ${k} of ${list.length} names used`);
  }
  fs.writeFileSync(file, JSON.stringify(roster));
  // the same surname or place in two paddocks reads as one team entered twice: say so
  const roots = new Map(), stop = new Set(['Team', 'Racing', 'Motorsport', 'Motorsports', 'Scuderia', 'Écurie', 'Corse', 'Endurance', 'Prototype', 'Compétition', 'Sport', 'Auto', 'Grand', 'Prix', 'F1', 'GT', 'Formula', 'Rennsport', 'Autosport', 'Works', 'Project', 'GP', 'Engineering', 'Race', 'One', 'Squadra', 'Équipe', 'Valley', 'State', 'City', '&', 'de', 'du', 'De']);
  for (const [key, list] of Object.entries(NAMES)) for (const n of list) for (const w of n.split(' ')) if (!stop.has(w) && w.length > 3) roots.set(w, [...(roots.get(w) || []), n]);
  const twice = [...roots.values()].filter(v => v.length > 1);
  console.log(twice.length ? 'shared words: ' + twice.map(v => v.join(' / ')).join('; ') : 'no word is shared between two names');
}
