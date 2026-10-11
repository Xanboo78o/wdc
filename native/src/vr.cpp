// vr.cpp — OpenXR around the renderer. See vr.hpp for the idea; this is the plumbing.
//
// Space: the headset's LOCAL space (x right, y up, z back, metres, origin where the session started). The game's car
// frame is GL's: x forward, y up, z right. Every pose the headset gives is carried across by one matrix, `trkToCar`,
// which is built from the seat: the hub of the wheel and the way it faces.
#include "vr.hpp"

#include <X11/Xlib.h>
#include <epoxy/gl.h>
#include <epoxy/glx.h>

#define XR_USE_PLATFORM_XLIB
#define XR_USE_GRAPHICS_API_OPENGL
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

// (OpenXR structs are started as `{XR_TYPE_...}` and filled in by hand; that is how every one of them is meant to be written)
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"

namespace xbr {

namespace {

constexpr float PI_F = 3.14159265358979f;

struct V3 { float x = 0, y = 0, z = 0; };
V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
V3 operator*(V3 a, float k) { return {a.x * k, a.y * k, a.z * k}; }
float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
float len(V3 a) { return std::sqrt(dot(a, a)); }

// a pose as a matrix (column-major, as Mat4 is): the quaternion's rotation, then the position
Mat4 fromPose(const XrPosef &p) {
  const float x = p.orientation.x, y = p.orientation.y, z = p.orientation.z, w = p.orientation.w;
  Mat4 m = Mat4::identity();
  m.m[0] = 1 - 2 * (y * y + z * z); m.m[1] = 2 * (x * y + z * w);     m.m[2] = 2 * (x * z - y * w);
  m.m[4] = 2 * (x * y - z * w);     m.m[5] = 1 - 2 * (x * x + z * z); m.m[6] = 2 * (y * z + x * w);
  m.m[8] = 2 * (x * z + y * w);     m.m[9] = 2 * (y * z - x * w);     m.m[10] = 1 - 2 * (x * x + y * y);
  m.m[12] = p.position.x; m.m[13] = p.position.y; m.m[14] = p.position.z;
  return m;
}

// the inverse of a rotation and a translation
Mat4 rigidInv(const Mat4 &m) {
  Mat4 r = Mat4::identity();
  for (int c = 0; c < 3; c++) for (int k = 0; k < 3; k++) r.m[c * 4 + k] = m.m[k * 4 + c];
  for (int k = 0; k < 3; k++) r.m[12 + k] = -(r.m[k] * m.m[12] + r.m[4 + k] * m.m[13] + r.m[8 + k] * m.m[14]);
  return r;
}

// an off-axis projection from the four angles the headset reports (GL clip space, depth -1..1)
Mat4 projFromFov(const XrFovf &f, float zn, float zf) {
  const float l = std::tan(f.angleLeft), r = std::tan(f.angleRight), u = std::tan(f.angleUp), d = std::tan(f.angleDown);
  Mat4 m;
  std::memset(m.m, 0, sizeof m.m);
  m.m[0] = 2 / (r - l); m.m[5] = 2 / (u - d);
  m.m[8] = (r + l) / (r - l); m.m[9] = (u + d) / (u - d);
  m.m[10] = -(zf + zn) / (zf - zn); m.m[11] = -1;
  m.m[14] = -2 * zf * zn / (zf - zn);
  return m;
}

V3 pos(const Mat4 &m) { return {m.m[12], m.m[13], m.m[14]}; }

bool xrOk(XrResult r, const char *what) {
  if (XR_SUCCEEDED(r)) return true;
  std::fprintf(stderr, "vr: %s failed (%d)\n", what, (int)r);
  return false;
}

}  // namespace

struct Vr::Impl {
  XrInstance inst = XR_NULL_HANDLE;
  XrSystemId sys = XR_NULL_SYSTEM_ID;
  XrSession session = XR_NULL_HANDLE;
  XrSpace local = XR_NULL_HANDLE;
  XrSessionState state = XR_SESSION_STATE_UNKNOWN;
  bool running = false;
  struct Chain {
    XrSwapchain sc = XR_NULL_HANDLE;
    int w = 0, h = 0;
    std::vector<unsigned> tex, fbo;
    uint32_t acquired = 0;
    bool held = false, done = false;      // an image is out to us / one was handed over this frame
  };
  Chain eye[2], hud;
  XrActionSet set = XR_NULL_HANDLE;
  XrAction trig[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE}, grip[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
  XrSpace gripSpace[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
  XrPath hand[2] = {0, 0};
  XrFrameState fs{XR_TYPE_FRAME_STATE};
  XrView views[2];
  bool rendering = false, frameOpen = false;
  float trigger[2] = {0, 0};
  bool handOk[2] = {false, false};
  Mat4 handPose[2] = {Mat4::identity(), Mat4::identity()};
  Mat4 headPose = Mat4::identity();
  Mat4 trkToCar = Mat4::identity();
  bool headOk = false;
  float eyeScale = 1;
  // the fake headset
  long frame = 0;
  V3 fakeHub{0, 0.96f, -0.55f};
  bool fakeHubSet = false;
  float fakeYaw = 0;

  bool makeChain(Chain &c, int w, int h, int64_t fmt) {
    XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    ci.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
    ci.format = fmt; ci.sampleCount = 1; ci.width = (uint32_t)w; ci.height = (uint32_t)h; ci.faceCount = 1; ci.arraySize = 1; ci.mipCount = 1;
    if (!xrOk(xrCreateSwapchain(session, &ci, &c.sc), "xrCreateSwapchain")) return false;
    c.w = w; c.h = h;
    uint32_t n = 0;
    xrEnumerateSwapchainImages(c.sc, 0, &n, nullptr);
    std::vector<XrSwapchainImageOpenGLKHR> im(n, {XR_TYPE_SWAPCHAIN_IMAGE_OPENGL_KHR});
    xrEnumerateSwapchainImages(c.sc, n, &n, (XrSwapchainImageBaseHeader *)im.data());
    for (uint32_t i = 0; i < n; i++) {
      c.tex.push_back(im[i].image);
      unsigned f = 0;
      glGenFramebuffers(1, &f);
      glBindFramebuffer(GL_FRAMEBUFFER, f);
      glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, im[i].image, 0);
      if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) std::fprintf(stderr, "vr: swapchain image %u has no complete framebuffer\n", i);
      c.fbo.push_back(f);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    return true;
  }
  int stuck = 0;                         // swapchain waits that ran out of time, in a row: the link is dead
  // (a wait with no end is a game that hangs for ever when the headset drops, and leaves the server holding a dead session)
  unsigned acquire(Chain &c) {
    c.held = false;
    XrSwapchainImageAcquireInfo ai{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
    if (!XR_SUCCEEDED(xrAcquireSwapchainImage(c.sc, &ai, &c.acquired))) { stuck++; return 0; }
    XrSwapchainImageWaitInfo wi{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
    wi.timeout = 400000000;              // 0.4 s
    if (xrWaitSwapchainImage(c.sc, &wi) != XR_SUCCESS) { stuck++; return 0; }
    stuck = 0;
    c.held = true;
    return c.fbo[c.acquired];
  }
  void release(Chain &c) {
    if (!c.held) return;
    // (the caller has finished the GPU's work on this image: Vr::sync)
    XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
    xrReleaseSwapchainImage(c.sc, &ri);
    c.held = false;
    c.done = true;
  }
  void pollEvents(bool &quit) {
    XrEventDataBuffer ev{XR_TYPE_EVENT_DATA_BUFFER};
    while (xrPollEvent(inst, &ev) == XR_SUCCESS) {
      if (ev.type == XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED) {
        const auto *s = (const XrEventDataSessionStateChanged *)&ev;
        state = s->state;
        std::fprintf(stderr, "vr: session state %d\n", (int)state);
        if (state == XR_SESSION_STATE_READY && !running) {
          XrSessionBeginInfo bi{XR_TYPE_SESSION_BEGIN_INFO};
          bi.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
          if (xrOk(xrBeginSession(session, &bi), "xrBeginSession")) running = true;
        } else if (state == XR_SESSION_STATE_STOPPING) {
          xrEndSession(session);
          running = false;
        } else if (state == XR_SESSION_STATE_EXITING || state == XR_SESSION_STATE_LOSS_PENDING) {
          running = false;
          quit = true;
        }
      } else if (ev.type == XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING) quit = true;
      ev = {XR_TYPE_EVENT_DATA_BUFFER};
    }
  }
};

Vr::Vr() : I(new Impl) {}
Vr::~Vr() { shutdown(); }

bool Vr::init(float scale) {
  Impl &M = *I;
  M.eyeScale = scale;
  // ---- the runtime
  const char *ext[] = {XR_KHR_OPENGL_ENABLE_EXTENSION_NAME};
  XrInstanceCreateInfo ci{XR_TYPE_INSTANCE_CREATE_INFO};
  std::strcpy(ci.applicationInfo.applicationName, "XBR");
  ci.applicationInfo.applicationVersion = 1;
  std::strcpy(ci.applicationInfo.engineName, "xbr-native");
  ci.applicationInfo.apiVersion = XR_API_VERSION_1_0;
  ci.enabledExtensionCount = 1; ci.enabledExtensionNames = ext;
  if (!xrOk(xrCreateInstance(&ci, &M.inst), "xrCreateInstance (is the headset on and WiVRn connected?)")) return false;
  XrSystemGetInfo si{XR_TYPE_SYSTEM_GET_INFO};
  si.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
  if (!xrOk(xrGetSystem(M.inst, &si, &M.sys), "xrGetSystem")) return false;
  XrSystemProperties sp{XR_TYPE_SYSTEM_PROPERTIES};
  xrGetSystemProperties(M.inst, M.sys, &sp);
  std::fprintf(stderr, "vr: %s\n", sp.systemName);
  PFN_xrGetOpenGLGraphicsRequirementsKHR getReq = nullptr;
  xrGetInstanceProcAddr(M.inst, "xrGetOpenGLGraphicsRequirementsKHR", (PFN_xrVoidFunction *)&getReq);
  if (!getReq) { std::fprintf(stderr, "vr: the runtime has no OpenGL\n"); return false; }
  XrGraphicsRequirementsOpenGLKHR req{XR_TYPE_GRAPHICS_REQUIREMENTS_OPENGL_KHR};
  getReq(M.inst, M.sys, &req);
  // ---- the session, on the GLX context the game is drawing with
  Display *dpy = glXGetCurrentDisplay();
  GLXContext ctx = glXGetCurrentContext();
  GLXDrawable drw = glXGetCurrentDrawable();
  if (!dpy || !ctx) { std::fprintf(stderr, "vr: the game is not drawing through GLX (the headset needs the X11 video driver)\n"); return false; }
  XrGraphicsBindingOpenGLXlibKHR gb{XR_TYPE_GRAPHICS_BINDING_OPENGL_XLIB_KHR};
  gb.xDisplay = dpy; gb.glxContext = ctx; gb.glxDrawable = drw;
  {
    int id = 0, n = 0;
    glXQueryContext(dpy, ctx, GLX_FBCONFIG_ID, &id);
    const int attr[] = {GLX_FBCONFIG_ID, id, 0};
    GLXFBConfig *cfg = glXChooseFBConfig(dpy, DefaultScreen(dpy), attr, &n);
    if (cfg && n > 0) {
      gb.glxFBConfig = cfg[0];
      if (XVisualInfo *vi = glXGetVisualFromFBConfig(dpy, cfg[0])) { gb.visualid = (uint32_t)vi->visualid; XFree(vi); }
      XFree(cfg);
    }
  }
  XrSessionCreateInfo sc{XR_TYPE_SESSION_CREATE_INFO};
  sc.next = &gb; sc.systemId = M.sys;
  if (!xrOk(xrCreateSession(M.inst, &sc, &M.session), "xrCreateSession")) return false;
  XrReferenceSpaceCreateInfo rs{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
  rs.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL; rs.poseInReferenceSpace.orientation.w = 1;
  if (!xrOk(xrCreateReferenceSpace(M.session, &rs, &M.local), "xrCreateReferenceSpace")) return false;
  // ---- the eyes
  uint32_t vn = 0;
  XrViewConfigurationView vc[2] = {{XR_TYPE_VIEW_CONFIGURATION_VIEW}, {XR_TYPE_VIEW_CONFIGURATION_VIEW}};
  xrEnumerateViewConfigurationViews(M.inst, M.sys, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO, 2, &vn, vc);
  if (vn != 2) { std::fprintf(stderr, "vr: the headset is not a stereo one\n"); return false; }
  eyeW = std::max(64, ((int)(vc[0].recommendedImageRectWidth * scale)) & ~1);
  eyeH = std::max(64, ((int)(vc[0].recommendedImageRectHeight * scale)) & ~1);
  uint32_t fn = 0;
  xrEnumerateSwapchainFormats(M.session, 0, &fn, nullptr);
  std::vector<int64_t> fmts(fn);
  xrEnumerateSwapchainFormats(M.session, fn, &fn, fmts.data());
  // sRGB first: the last pass writes picture-ready values, and the headset must read them as exactly that
  int64_t fmt = 0;
  for (int64_t want : {(int64_t)GL_SRGB8_ALPHA8, (int64_t)GL_RGBA8})
    if (!fmt && std::find(fmts.begin(), fmts.end(), want) != fmts.end()) fmt = want;
  if (!fmt) { std::fprintf(stderr, "vr: no usable swapchain format\n"); return false; }
  glDisable(GL_FRAMEBUFFER_SRGB);
  for (int e = 0; e < 2; e++) if (!M.makeChain(M.eye[e], eyeW, eyeH, fmt)) return false;
  if (!M.makeChain(M.hud, HUD_W, HUD_H, fmt)) return false;
  std::fprintf(stderr, "vr: eyes %dx%d (%.0f%% of the %ux%u it recommends), format %s\n", eyeW, eyeH, scale * 100, vc[0].recommendedImageRectWidth,
               vc[0].recommendedImageRectHeight, fmt == GL_SRGB8_ALPHA8 ? "sRGB" : "RGBA8");
  // ---- the hands
  xrStringToPath(M.inst, "/user/hand/left", &M.hand[0]);
  xrStringToPath(M.inst, "/user/hand/right", &M.hand[1]);
  XrActionSetCreateInfo as{XR_TYPE_ACTION_SET_CREATE_INFO};
  std::strcpy(as.actionSetName, "drive"); std::strcpy(as.localizedActionSetName, "Driving");
  if (!xrOk(xrCreateActionSet(M.inst, &as, &M.set), "xrCreateActionSet")) return false;
  for (int h = 0; h < 2; h++) {
    const char *side = h ? "right" : "left";
    XrActionCreateInfo ai{XR_TYPE_ACTION_CREATE_INFO};
    ai.countSubactionPaths = 1; ai.subactionPaths = &M.hand[h];
    ai.actionType = XR_ACTION_TYPE_FLOAT_INPUT;
    std::snprintf(ai.actionName, sizeof ai.actionName, "trigger_%s", side); std::snprintf(ai.localizedActionName, sizeof ai.localizedActionName, "Trigger %s", side);
    xrCreateAction(M.set, &ai, &M.trig[h]);
    ai.actionType = XR_ACTION_TYPE_POSE_INPUT;
    std::snprintf(ai.actionName, sizeof ai.actionName, "grip_%s", side); std::snprintf(ai.localizedActionName, sizeof ai.localizedActionName, "Hand %s", side);
    xrCreateAction(M.set, &ai, &M.grip[h]);
  }
  XrPath profile, p[4];
  xrStringToPath(M.inst, "/interaction_profiles/oculus/touch_controller", &profile);
  xrStringToPath(M.inst, "/user/hand/left/input/trigger/value", &p[0]);
  xrStringToPath(M.inst, "/user/hand/right/input/trigger/value", &p[1]);
  xrStringToPath(M.inst, "/user/hand/left/input/grip/pose", &p[2]);
  xrStringToPath(M.inst, "/user/hand/right/input/grip/pose", &p[3]);
  XrActionSuggestedBinding b[4] = {{M.trig[0], p[0]}, {M.trig[1], p[1]}, {M.grip[0], p[2]}, {M.grip[1], p[3]}};
  XrInteractionProfileSuggestedBinding sb{XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING};
  sb.interactionProfile = profile; sb.countSuggestedBindings = 4; sb.suggestedBindings = b;
  xrSuggestInteractionProfileBindings(M.inst, &sb);
  XrSessionActionSetsAttachInfo at{XR_TYPE_SESSION_ACTION_SETS_ATTACH_INFO};
  at.countActionSets = 1; at.actionSets = &M.set;
  if (!xrOk(xrAttachSessionActionSets(M.session, &at), "xrAttachSessionActionSets")) return false;
  for (int h = 0; h < 2; h++) {
    XrActionSpaceCreateInfo ac{XR_TYPE_ACTION_SPACE_CREATE_INFO};
    ac.action = M.grip[h]; ac.subactionPath = M.hand[h]; ac.poseInActionSpace.orientation.w = 1;
    xrCreateActionSpace(M.session, &ac, &M.gripSpace[h]);
  }
  // ---- wait for the headset to say it is ready (a few seconds at most)
  for (int i = 0; i < 400 && !M.running; i++) {
    M.pollEvents(wantQuit);
    if (!M.running) SDL_Delay(10);
  }
  if (!M.running) { std::fprintf(stderr, "vr: the session never became ready (state %d)\n", (int)M.state); return false; }
  live = true;
  say = "HOLD THE CONTROLLERS AT THE WHEEL, SQUEEZE BOTH TRIGGERS, LET GO TO START";
  return true;
}

bool Vr::initFake(float scale, int w, int h) {
  isFake = true;
  eyeW = w; eyeH = h;
  (void)scale;
  Impl &M = *I;
  if (const char *e = std::getenv("XBR_VRFAKE_HUB")) { float x, y, z; if (std::sscanf(e, "%f,%f,%f", &x, &y, &z) == 3) { M.fakeHub = {x, y, z}; M.fakeHubSet = true; } }
  if (const char *e = std::getenv("XBR_VRFAKE_YAW")) M.fakeYaw = (float)std::atof(e) * PI_F / 180;
  say = "HOLD THE CONTROLLERS AT THE WHEEL, SQUEEZE BOTH TRIGGERS, LET GO TO START";
  return true;
}

void Vr::shutdown() {
  Impl &M = *I;
  if (live) {
    // the order the headset's side expects: ask it to stop, let it say so (and end the session when it does), then tear down
    // from the inside out. (Tearing down while the GL context is still being read from the other side is a crash on the way out.)
    glFinish();
    if (M.running) {
      xrRequestExitSession(M.session);
      bool q = false;
      for (int i = 0; i < 100 && M.running; i++) { M.pollEvents(q); if (M.running) SDL_Delay(10); }
    }
    for (auto &c : M.eye) { if (c.sc) xrDestroySwapchain(c.sc); c.sc = XR_NULL_HANDLE; }
    if (M.hud.sc) xrDestroySwapchain(M.hud.sc);
    M.hud.sc = XR_NULL_HANDLE;
    for (auto &c : M.eye) { for (unsigned f : c.fbo) glDeleteFramebuffers(1, &f); c.fbo.clear(); }
    for (unsigned f : M.hud.fbo) glDeleteFramebuffers(1, &f);
    M.hud.fbo.clear();
    for (int h = 0; h < 2; h++) { if (M.gripSpace[h]) xrDestroySpace(M.gripSpace[h]); M.gripSpace[h] = XR_NULL_HANDLE; }
    if (M.local) xrDestroySpace(M.local);
    M.local = XR_NULL_HANDLE;
    for (int h = 0; h < 2; h++) { if (M.trig[h]) xrDestroyAction(M.trig[h]); if (M.grip[h]) xrDestroyAction(M.grip[h]); M.trig[h] = M.grip[h] = XR_NULL_HANDLE; }
    if (M.set) xrDestroyActionSet(M.set);
    M.set = XR_NULL_HANDLE;
    if (M.session) xrDestroySession(M.session);
    if (M.inst) xrDestroyInstance(M.inst);
    M.session = XR_NULL_HANDLE; M.inst = XR_NULL_HANDLE;
    live = false;
  }
  isFake = false;
}

void Vr::setCockpit(const float hub[3], const float eye[3]) {
  for (int k = 0; k < 3; k++) { hubCar[k] = hub[k]; eyeCarSeat[k] = eye[k]; }
}

void Vr::recenter() { locked = false; haveSeat = false; }

// the matrix that carries the headset's space into the car's, from where the hub is and the way it faces
void Vr::place() {
  const V3 f{face[0], face[1], face[2]}, up{0, 1, 0}, r = cross(f, up), h{hubTrk[0], hubTrk[1], hubTrk[2]};
  Mat4 T = Mat4::identity();
  T.m[0] = f.x; T.m[4] = f.y; T.m[8] = f.z;           // car x (forward) = along the facing
  T.m[1] = 0;   T.m[5] = 1;   T.m[9] = 0;             // car y (up)
  T.m[2] = r.x; T.m[6] = r.y; T.m[10] = r.z;          // car z (right)
  T.m[12] = hubCar[0] - dot(f, h); T.m[13] = hubCar[1] - h.y; T.m[14] = hubCar[2] - dot(r, h);
  I->trkToCar = T;
}

bool Vr::begin() {
  Impl &M = *I;
  if (live && !M.running) SDL_Delay(8);              // (not worn, or a menu over it: do not spin)
  M.rendering = false; shown = false;
  M.eye[0].done = M.eye[1].done = M.hud.done = false;
  V3 hl{}, hr{};
  bool trigL = false, trigR = false, handsOk = false;
  if (isFake) {
    // a seated body: the head 1.15 m up, the wheel's hub 0.55 m ahead and 0.19 m down, the two hands on it at nine and three
    const float s = std::sin(M.fakeYaw), c = std::cos(M.fakeYaw);
    XrPosef hp{};
    hp.orientation = {0, std::sin(M.fakeYaw / 2), 0, std::cos(M.fakeYaw / 2)};      // turned about up, to the left for a positive angle
    hp.position = {0, 1.15f, 0};
    const Mat4 head = fromPose(hp);
    M.headPose = head;
    const V3 fwd{-s, 0, -c}, rgt{c, 0, -s};
    const V3 hub = M.fakeHubSet ? M.fakeHub : pos(head) + fwd * 0.55f + V3{0, -0.19f, 0};
    for (int h = 0; h < 2; h++) {
      const V3 p = hub + rgt * (h ? 0.17f : -0.17f);
      Mat4 g = Mat4::identity(); g.m[12] = p.x; g.m[13] = p.y; g.m[14] = p.z;
      M.handPose[h] = g; M.handOk[h] = true;
    }
    hl = pos(M.handPose[0]); hr = pos(M.handPose[1]);
    handsOk = true;
    trigL = trigR = M.frame >= 2 && M.frame < 8;              // squeezed for a few frames, then let go
    M.headOk = true;
    // the eyes: 64 mm apart, 90 degrees across
    XrFovf fov{-0.78f, 0.78f, 0.70f, -0.70f};
    for (int e = 0; e < 2; e++) {
      Mat4 ep = head; const float dx = e ? 0.032f : -0.032f;
      ep.m[12] += head.m[0] * dx; ep.m[13] += head.m[1] * dx; ep.m[14] += head.m[2] * dx;
      M.views[e].pose.position = {ep.m[12], ep.m[13], ep.m[14]};
      M.views[e].pose.orientation = hp.orientation;
      M.views[e].fov = fov;
    }
    M.rendering = true;
    M.frame++;
  } else {
    bool quit = false;
    M.pollEvents(quit);
    if (quit) wantQuit = true;
    if (!M.running) { say = "THE HEADSET IS NOT RUNNING"; return false; }
    M.fs = {XR_TYPE_FRAME_STATE};
    XrFrameWaitInfo wi{XR_TYPE_FRAME_WAIT_INFO};
    if (!XR_SUCCEEDED(xrWaitFrame(M.session, &wi, &M.fs))) return false;
    XrFrameBeginInfo bi{XR_TYPE_FRAME_BEGIN_INFO};
    if (!XR_SUCCEEDED(xrBeginFrame(M.session, &bi))) return false;
    M.frameOpen = true;
    M.rendering = M.fs.shouldRender == XR_TRUE;
    if (!M.rendering) { SDL_Delay(4); return false; }       // (worn off, or the headset's own menu is up: nothing to draw, nothing to hurry)
    // the hands
    XrActiveActionSet aas{M.set, XR_NULL_PATH};
    XrActionsSyncInfo sy{XR_TYPE_ACTIONS_SYNC_INFO};
    sy.countActiveActionSets = 1; sy.activeActionSets = &aas;
    xrSyncActions(M.session, &sy);
    for (int h = 0; h < 2; h++) {
      XrActionStateGetInfo gi{XR_TYPE_ACTION_STATE_GET_INFO};
      gi.action = M.trig[h]; gi.subactionPath = M.hand[h];
      XrActionStateFloat st{XR_TYPE_ACTION_STATE_FLOAT};
      xrGetActionStateFloat(M.session, &gi, &st);
      M.trigger[h] = st.isActive ? st.currentState : 0;
      XrSpaceLocation loc{XR_TYPE_SPACE_LOCATION};
      xrLocateSpace(M.gripSpace[h], M.local, M.fs.predictedDisplayTime, &loc);
      const XrSpaceLocationFlags need = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
      M.handOk[h] = (loc.locationFlags & need) == need;
      if (M.handOk[h]) M.handPose[h] = fromPose(loc.pose);
    }
    handsOk = M.handOk[0] && M.handOk[1];
    if (handsOk) { hl = pos(M.handPose[0]); hr = pos(M.handPose[1]); }
    trigL = M.trigger[0] > 0.6f; trigR = M.trigger[1] > 0.6f;
    // the eyes
    XrViewLocateInfo vl{XR_TYPE_VIEW_LOCATE_INFO};
    vl.viewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO; vl.displayTime = M.fs.predictedDisplayTime; vl.space = M.local;
    XrViewState vs{XR_TYPE_VIEW_STATE};
    uint32_t n = 0;
    M.views[0] = {XR_TYPE_VIEW}; M.views[1] = {XR_TYPE_VIEW};
    xrLocateViews(M.session, &vl, &vs, 2, &n, M.views);
    M.headOk = (vs.viewStateFlags & XR_VIEW_STATE_POSITION_VALID_BIT) != 0;
    if (!M.headOk) { M.rendering = false; return false; }
    // the head is half way between the eyes, facing the way they do
    M.headPose = fromPose(M.views[0].pose);
    const V3 a = {M.views[0].pose.position.x, M.views[0].pose.position.y, M.views[0].pose.position.z},
             b = {M.views[1].pose.position.x, M.views[1].pose.position.y, M.views[1].pose.position.z};
    const V3 mid = (a + b) * 0.5f;
    M.headPose.m[12] = mid.x; M.headPose.m[13] = mid.y; M.headPose.m[14] = mid.z;
  }

  // ---- the seat
  const V3 head = pos(M.headPose), up{0, 1, 0};
  // level, the way the head looks (its -z axis)
  V3 hf{-M.headPose.m[8], 0, -M.headPose.m[10]};
  if (len(hf) < 0.2f) hf = {face[0], 0, face[2]};
  hf = hf * (1 / std::max(1e-4f, len(hf)));
  if (!haveSeat) {
    // the guess: the driver's eyes where the head is, the wheel where the car puts it, facing where the head faces
    face[0] = hf.x; face[1] = 0; face[2] = hf.z;
    const V3 fl{face[0], 0, face[2]}, rr = cross(fl, up);
    const float dx = hubCar[0] - eyeCarSeat[0], dy = hubCar[1] - eyeCarSeat[1], dz = hubCar[2] - eyeCarSeat[2];
    const V3 hub = head + fl * dx + up * dy + rr * dz;
    hubTrk[0] = hub.x; hubTrk[1] = hub.y; hubTrk[2] = hub.z;
    haveSeat = true;
  }
  const Uint64 nowT = SDL_GetTicksNS();
  const float dtv = isFake ? 1.0f / 60 : std::min(0.1f, lastTick ? (nowT - lastTick) / 1e9f : 0.0f);
  lastTick = nowT;
  if (trigL && trigR && handsOk) {
    // Squeezed. A squeeze anywhere in the headset (a menu, a stray finger) must not move the seat: it takes 0.8 s of holding.
    // After that the wheel is wherever the hands are, and follows them while they hold it.
    holdT += dtv;
    if (holdT >= 0.8f) {
      V3 across = hr - hl;
      across.y = 0;
      if (len(across) > 0.06f) {
        across = across * (1 / len(across));
        const V3 f = cross(up, across);
        face[0] = f.x; face[1] = 0; face[2] = f.z;
      }
      const V3 hub = (hl + hr) * 0.5f;
      hubTrk[0] = hub.x; hubTrk[1] = hub.y; hubTrk[2] = hub.z;
      holding = true;
      say = "LET GO WHEN IT LOOKS RIGHT: THE RACE STARTS";
    } else say = "KEEP HOLDING...";
  } else {
    if (holding) {
      holding = false; locked = true;
      say = "";
      std::fprintf(stderr, "vr: seat set - hub at (%.2f, %.2f, %.2f), facing (%.2f, %.2f)\n", hubTrk[0], hubTrk[1], hubTrk[2], face[0], face[2]);
    }
    holdT = 0;
    if (!locked) say = "HOLD THE CONTROLLERS AT THE WHEEL, SQUEEZE BOTH TRIGGERS, LET GO TO START";
  }
  place();

  // ---- each eye, in the car's frame
  for (int e = 0; e < 2; e++) {
    const Mat4 ep = M.trkToCar * fromPose(M.views[e].pose);
    eyes[e].viewCar = rigidInv(ep);
    eyes[e].proj = projFromFov(M.views[e].fov, 0.05f, 12000.0f);
    eyes[e].eyeCar[0] = ep.m[12]; eyes[e].eyeCar[1] = ep.m[13]; eyes[e].eyeCar[2] = ep.m[14];
    for (int k = 0; k < 3; k++) eyes[e].atCar[k] = eyes[e].eyeCar[k] - 24 * ep.m[8 + k];
  }
  shown = M.rendering;
  return M.rendering;
}

// The pictures are drawn by the GPU, a while after the calls that ask for them, and the headset's side reads them from another
// process: finish drawing before they are handed over, or they are shown half-made or from a frame ago. Once for the whole frame
// (both eyes queued first), not once an eye: the CPU is already getting the second eye ready while the GPU draws the first.
void Vr::sync() { if (live) glFinish(); }

unsigned Vr::acquireEye(int i) { return live ? I->acquire(I->eye[i]) : 0; }
void Vr::releaseEye(int i) { if (live) I->release(I->eye[i]); }
unsigned Vr::acquireHud() { return live ? I->acquire(I->hud) : 0; }
void Vr::releaseHud() { if (live) I->release(I->hud); }

void Vr::end() {
  Impl &M = *I;
  if (!live || !M.frameOpen) return;
  M.frameOpen = false;
  XrCompositionLayerProjectionView pv[2] = {{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}, {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}};
  XrCompositionLayerProjection pl{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
  XrCompositionLayerQuad ql{XR_TYPE_COMPOSITION_LAYER_QUAD};
  const XrCompositionLayerBaseHeader *layers[2];
  uint32_t n = 0;
  if (M.stuck >= 3) { wantQuit = true; std::fprintf(stderr, "vr: the headset stopped taking pictures: closing\n"); }
  if (M.rendering && M.eye[0].done && M.eye[1].done) {
    for (int e = 0; e < 2; e++) {
      pv[e].pose = M.views[e].pose; pv[e].fov = M.views[e].fov;
      pv[e].subImage.swapchain = M.eye[e].sc;
      pv[e].subImage.imageRect = {{0, 0}, {M.eye[e].w, M.eye[e].h}};
    }
    pl.space = M.local; pl.viewCount = 2; pl.views = pv;
    layers[n++] = (const XrCompositionLayerBaseHeader *)&pl;
    // THE PANEL: 1.1 m ahead of the hub, a little above it, facing you, fixed to the car (the seat is fixed to the car)
    const V3 up{0, 1, 0}, f{face[0], 0, face[2]};
    const V3 centre = V3{hubTrk[0], hubTrk[1], hubTrk[2]} + f * 0.55f + up * 0.20f;
    const V3 r = cross(f, up), z = f * -1;       // the panel's own axes: x right, y up, z toward you
    Mat4 q = Mat4::identity();
    q.m[0] = r.x; q.m[1] = r.y; q.m[2] = r.z; q.m[4] = up.x; q.m[5] = up.y; q.m[6] = up.z; q.m[8] = z.x; q.m[9] = z.y; q.m[10] = z.z;
    // rotation matrix -> quaternion
    const float tr = q.m[0] + q.m[5] + q.m[10];
    XrQuaternionf Q;
    if (tr > 0) { const float s = std::sqrt(tr + 1) * 2; Q = {(q.m[6] - q.m[9]) / s, (q.m[8] - q.m[2]) / s, (q.m[1] - q.m[4]) / s, s / 4}; }
    else if (q.m[0] > q.m[5] && q.m[0] > q.m[10]) { const float s = std::sqrt(1 + q.m[0] - q.m[5] - q.m[10]) * 2; Q = {s / 4, (q.m[4] + q.m[1]) / s, (q.m[8] + q.m[2]) / s, (q.m[6] - q.m[9]) / s}; }
    else if (q.m[5] > q.m[10]) { const float s = std::sqrt(1 + q.m[5] - q.m[0] - q.m[10]) * 2; Q = {(q.m[4] + q.m[1]) / s, s / 4, (q.m[9] + q.m[6]) / s, (q.m[8] - q.m[2]) / s}; }
    else { const float s = std::sqrt(1 + q.m[10] - q.m[0] - q.m[5]) * 2; Q = {(q.m[8] + q.m[2]) / s, (q.m[9] + q.m[6]) / s, s / 4, (q.m[1] - q.m[4]) / s}; }
    const bool panel = M.hud.done;
    ql.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT | XR_COMPOSITION_LAYER_UNPREMULTIPLIED_ALPHA_BIT;
    ql.space = M.local; ql.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
    ql.subImage.swapchain = M.hud.sc; ql.subImage.imageRect = {{0, 0}, {M.hud.w, M.hud.h}};
    ql.pose.orientation = Q; ql.pose.position = {centre.x, centre.y, centre.z};
    ql.size = {0.64f, 0.36f};
    if (panel) layers[n++] = (const XrCompositionLayerBaseHeader *)&ql;
  }
  XrFrameEndInfo ei{XR_TYPE_FRAME_END_INFO};
  ei.displayTime = M.fs.predictedDisplayTime; ei.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
  ei.layerCount = n; ei.layers = n ? layers : nullptr;
  xrEndFrame(M.session, &ei);
}

void Vr::headInCar(float out[3]) const {
  const V3 p = pos(I->trkToCar * I->headPose);
  out[0] = p.x; out[1] = p.y; out[2] = p.z;
}

bool Vr::handsInCar(float l[3], float r[3]) const {
  if (!I->handOk[0] || !I->handOk[1]) return false;
  const V3 a = pos(I->trkToCar * I->handPose[0]), b = pos(I->trkToCar * I->handPose[1]);
  l[0] = a.x; l[1] = a.y; l[2] = a.z; r[0] = b.x; r[1] = b.y; r[2] = b.z;
  return true;
}

}  // namespace xbr
