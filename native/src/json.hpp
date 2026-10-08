// json.hpp — just enough JSON to read the baked circuits, aero maps and wheel
// profiles the browser game already ships. Read-only, no dependencies.
#pragma once
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace xbr {

struct Json {
  enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
  bool b = false;
  double num = 0;
  std::string str;
  std::vector<Json> arr;
  std::vector<std::pair<std::string, Json>> obj;

  bool isNull() const { return type == Null; }
  bool isArr() const { return type == Arr; }
  bool isObj() const { return type == Obj; }
  bool isNum() const { return type == Num; }
  size_t size() const { return type == Arr ? arr.size() : obj.size(); }

  // A missing key reads as null, the way `undefined` does in the JS.
  const Json &operator[](const char *k) const {
    static const Json none;
    if (type != Obj) return none;
    for (const auto &kv : obj) if (kv.first == k) return kv.second;
    return none;
  }
  const Json &operator[](size_t i) const {
    static const Json none;
    return (type == Arr && i < arr.size()) ? arr[i] : none;
  }
  bool has(const char *k) const { return !(*this)[k].isNull(); }
  double n(double dflt = 0) const { return type == Num ? num : dflt; }
  bool truthy() const {
    switch (type) {
      case Bool: return b;
      case Num: return num != 0 && !std::isnan(num);
      case Str: return !str.empty();
      case Arr: case Obj: return true;
      default: return false;
    }
  }
  std::string s(const std::string &dflt = "") const { return type == Str ? str : dflt; }
  std::vector<double> nums() const {
    std::vector<double> out;
    out.reserve(arr.size());
    for (const auto &v : arr) out.push_back(v.n());
    return out;
  }

  static Json parse(const std::string &text) {
    Parser p{text.data(), text.data() + text.size()};
    Json v = p.value();
    return v;
  }
  static Json load(const std::string &path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot open " + path);
    std::stringstream ss;
    ss << f.rdbuf();
    return parse(ss.str());
  }
  // Null when the file is not there, for data that is optional.
  static Json loadOpt(const std::string &path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return Json{};
    std::stringstream ss;
    ss << f.rdbuf();
    try { return parse(ss.str()); } catch (...) { return Json{}; }
  }

 private:
  struct Parser {
    const char *p, *end;
    void ws() { while (p < end && (*p == ' ' || *p == '\n' || *p == '\t' || *p == '\r')) p++; }
    [[noreturn]] void fail(const char *why) { throw std::runtime_error(std::string("json: ") + why); }
    Json value() {
      ws();
      if (p >= end) fail("unexpected end");
      Json v;
      char c = *p;
      if (c == '{') {
        v.type = Obj; p++; ws();
        if (p < end && *p == '}') { p++; return v; }
        for (;;) {
          ws();
          std::string k = string();
          ws();
          if (p >= end || *p != ':') fail("expected ':'");
          p++;
          v.obj.emplace_back(std::move(k), value());
          ws();
          if (p < end && *p == ',') { p++; continue; }
          if (p < end && *p == '}') { p++; return v; }
          fail("expected ',' or '}'");
        }
      }
      if (c == '[') {
        v.type = Arr; p++; ws();
        if (p < end && *p == ']') { p++; return v; }
        for (;;) {
          v.arr.push_back(value());
          ws();
          if (p < end && *p == ',') { p++; continue; }
          if (p < end && *p == ']') { p++; return v; }
          fail("expected ',' or ']'");
        }
      }
      if (c == '"') { v.type = Str; v.str = string(); return v; }
      if (c == 't' && end - p >= 4) { p += 4; v.type = Bool; v.b = true; return v; }
      if (c == 'f' && end - p >= 5) { p += 5; v.type = Bool; v.b = false; return v; }
      if (c == 'n' && end - p >= 4) { p += 4; return v; }
      char *e = nullptr;
      v.num = std::strtod(p, &e);
      if (e == p) fail("bad value");
      p = e; v.type = Num;
      return v;
    }
    std::string string() {
      if (p >= end || *p != '"') fail("expected string");
      p++;
      std::string out;
      while (p < end && *p != '"') {
        if (*p == '\\' && p + 1 < end) {
          p++;
          switch (*p) {
            case 'n': out += '\n'; break;
            case 't': out += '\t'; break;
            case 'r': out += '\r'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'u': {
              if (end - p < 5) fail("bad escape");
              unsigned cp = (unsigned)std::strtoul(std::string(p + 1, p + 5).c_str(), nullptr, 16);
              p += 4;
              if (cp < 0x80) out += (char)cp;
              else if (cp < 0x800) { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
              else { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F)); out += (char)(0x80 | (cp & 0x3F)); }
              break;
            }
            default: out += *p;
          }
          p++;
        } else out += *p++;
      }
      if (p >= end) fail("unterminated string");
      p++;
      return out;
    }
  };
};

}  // namespace xbr
