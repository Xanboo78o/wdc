// vr.hpp — the headset. OpenXR (WiVRn on this machine, Quest 3S over the USB cable) around the game's own renderer:
// the same world and the same car, drawn once for each eye from where the head is.
//
// THE SEAT. You sit at the real wheel with your hands on it. The game does not know where your real wheel is, so you
// tell it: hold both controllers where the rim is (nine and three), squeeze both triggers, let go. The hub of the
// virtual wheel is put where your hands were, and the cockpit is built round that point. Then the controllers go away.
//   - the hub     = half way between the two hands
//   - the facing  = across the line between them, level
// Before you have done that the seat is a guess: the driver's eyes where your head is, facing the way you face.
//
// The sim never includes this file. It reads no car and writes nothing the physics depends on.
#pragma once
#include <memory>

#include "render.hpp"

struct SDL_Window;

namespace xbr {

class Vr {
 public:
  Vr();
  ~Vr();
  // The headset. False (and the reason on stderr) when there is no runtime or no headset answering.
  // scale: share of the recommended eye size to draw at (the GTX 1060 is the limit, not the headset).
  bool init(float scale);
  // No headset: a body seated at a wheel, for checking the picture without anybody in the headset. The script (the
  // triggers squeezed for the first frames, then let go) and where the "real" wheel is are the XBR_VRFAKE_* variables.
  bool initFake(float scale, int w, int h);
  void shutdown();
  bool on() const { return live || isFake; }
  bool fake() const { return isFake; }

  int eyeW = 0, eyeH = 0;                      // each eye's picture
  static constexpr int HUD_W = 1280, HUD_H = 720;

  // ---- one frame. begin() waits for the headset's own beat (72 Hz, 90 Hz) and locates the head and the hands.
  // false: the headset is not asking for a picture right now (not worn, a menu over it): draw nothing, still call end().
  bool begin();
  struct Eye {
    Mat4 viewCar, proj;                        // car frame -> this eye; the eye's own projection (asymmetric)
    float eyeCar[3] = {0, 0, 0}, atCar[3] = {24, 0, 0};
  };
  Eye eye(int i) const { return eyes[i]; }
  void sync();                                 // wait for the GPU to finish what was queued: call once, before releasing the eyes
  unsigned acquireEye(int i);                  // the framebuffer to draw eye i into (GL texture of the headset's swapchain)
  void releaseEye(int i);
  unsigned acquireHud();                       // the panel in front of you: the same HUD the screen shows, as a flat picture
  void releaseHud();
  void end();                                  // hand the pictures to the headset

  // ---- the seat
  // hub / eye: the cockpit wheel's hub and the driver's eye in the car frame (Renderer::wheelHub). Cheap; call every frame.
  void setCockpit(const float hub[3], const float eye[3]);
  bool calibrating() const { return holding; }        // both triggers squeezed right now
  bool calibrated() const { return locked; }          // done once, by hand
  void recenter();                                    // forget the seat: the guess again, from where the head is now
  bool seeing() const { return shown; }               // the headset is being worn and wants a picture (not: off the head, a menu over it)
  bool quit() const { return wantQuit; }              // the headset went away for good (or stopped taking pictures)
  // for the checks: where the head is, in the car frame
  void headInCar(float out[3]) const;
  // where the controllers are, in the car frame (false if one is not tracked)
  bool handsInCar(float l[3], float r[3]) const;
  const char *status() const { return say; }

 private:
  struct Impl;
  std::unique_ptr<Impl> I;
  Eye eyes[2];
  bool live = false, isFake = false, holding = false, locked = false, wantQuit = false;
  const char *say = "";
  float hubCar[3] = {0.4f, 0.55f, 0}, eyeCarSeat[3] = {-0.1f, 0.74f, 0};
  float hubTrk[3] = {0, 0, 0}, face[3] = {0, 0, -1};  // the wheel's hub and the way it faces, in the headset's own space
  bool haveSeat = false, shown = false;
  float holdT = 0;                                    // seconds both triggers have been squeezed
  unsigned long long lastTick = 0;
  void place();
};

}  // namespace xbr
