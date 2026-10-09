// drivers.hpp — twenty-two people, not twenty-two copies of one (js/drivers.js).
// One table drives the car (`pace`), the driver (`agg`, `def`, `err`, `sk`) and
// the livery (`col`). The reasons for every number are in the JS file.
#pragma once
#include <string>
#include <vector>

#include "driver.hpp"

namespace xbr {

struct Team {
  std::string key, name, col, fg;
  double pace = 1;
  std::vector<std::string> sp;       // sponsors, title sponsor first (invented brands)
  std::string era, sub, league;      // era: "2026" | "fantasy" | "classic" | ""
  std::string ui[2];                 // [primary, secondary], empty when the team has none
};
struct DriverProfile {
  std::string n, t;                  // name, team key
  int num = 0;
  double agg = 0.72, def = 0.74, err = 1.0, sk = 1.0;
};
struct StyleRow { const char *n; double launch, space, side; };

const std::vector<Team> &allTeams();                 // insertion order of js TEAMS
const Team *teamByKey(const std::string &key);       // null when there is no such team
std::vector<std::string> teamsIn(const std::string &league);
const std::vector<DriverProfile> &DRIVERS();         // the 2026 grid; the order IS the grid
const std::vector<DriverProfile> &FANTASY_DRIVERS();
const std::vector<DriverProfile> &leagueDrivers(const std::string &league);   // "f1classic" | "gt3" | "f4"
const StyleRow *styleOf(const std::string &name);

// WHO IS ON THE GRID. Module state, exactly as in the JS: setField picks the
// roster, setPlayerTeam takes your seat out of it, driverAt indexes what is left.
void setField(const std::string &kind);              // "classic" | "fantasy" | "all" | "gt3" | "f4" | anything else = 2026
const DriverProfile *setPlayerTeam(const std::string &key, int n = 22);   // returns your teammate, or null
const DriverProfile &driverAt(int i);
std::vector<const DriverProfile *> driversOf(const std::string &key);
const Team &teamOf(const DriverProfile &d);
// [background, ink, primary, secondary]; false when the team has no UI colours
bool teamUI(const std::string &key, std::string out[4]);

// Apply a person and a car to a driver the tier already built. MULTIPLY, do
// not replace: a profile shifts a driver WITHIN its tier.
Driver &applyProfile(Driver &driver, const DriverProfile &prof, const Team &team);

}  // namespace xbr
