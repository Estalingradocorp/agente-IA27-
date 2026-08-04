(function () {
  "use strict";

  const BG = "rgba(5, 7, 12, 0.22)";
  const STARS_COLORS = ["#9fd0ff", "#dbe7f7", "#6cc5ff", "#ffffff", "#7aa7ff"];

  class Galaxy {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = 0;
      this.h = 0;
      this.mouse = { x: 0.5, y: 0.5 };
      this.active = false;
      this.intensity = 0;
      this.time = 0;
      this.lastRipple = 0;
      this.ripples = [];
      this.stars = [];
      this.arms = [];

      this._buildStars();
      this._buildArms();
      this.resize();
      this._bind();
      this._loop();
    }

    _buildStars() {
      this.stars = [];
      for (let i = 0; i < 240; i += 1) {
        this.stars.push({
          x: Math.random(),
          y: Math.random(),
          z: Math.random() * 0.9 + 0.1,
          size: Math.random() * 1.6 + 0.4,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.4 + Math.random() * 1.6,
          color: STARS_COLORS[(Math.random() * STARS_COLORS.length) | 0],
        });
      }
    }

    _buildArms() {
      this.arms = [];
      const armCount = 3;
      for (let a = 0; a < armCount; a += 1) {
        const baseAngle = (a / armCount) * Math.PI * 2;
        for (let i = 0; i < 46; i += 1) {
          const t = i / 46;
          this.arms.push({
            baseAngle,
            t,
            offset: (Math.random() - 0.5) * 0.55,
            size: 0.7 + Math.random() * 1.5,
            phase: Math.random() * Math.PI * 2,
            brightness: 0.35 + Math.random() * 0.65,
          });
        }
      }
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.w = rect.width;
      this.h = rect.height;
      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _bind() {
      window.addEventListener("resize", () => this.resize());
      this.canvas.addEventListener("mousemove", (e) => {
        const r = this.canvas.getBoundingClientRect();
        this.mouse.x = (e.clientX - r.left) / r.width;
        this.mouse.y = (e.clientY - r.top) / r.height;
      });
    }

    setActive(on) {
      this.active = on;
    }

    noteToken() {
      this.intensity = Math.min(1, this.intensity + 0.45);
    }

    _spawnRipple() {
      this.ripples.push({ r: 4, alpha: 0.85 });
    }

    _loop(now) {
      const dt = Math.min(0.05, (now - (this._lastTime || now)) / 1000 || 0.016);
      this._lastTime = now;
      this.time += dt;

      if (this.active) {
        if (now - this.lastRipple > 520) {
          this.lastRipple = now;
          this._spawnRipple();
        }
        this.intensity = Math.max(this.intensity, 0.18);
      }
      this.intensity = Math.max(0, this.intensity - dt * 0.45);

      this._draw(dt);
      requestAnimationFrame((t) => this._loop(t));
    }

    _draw(dt) {
      const ctx = this.ctx;
      const { w, h } = this;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#05070c";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2 + (this.mouse.x - 0.5) * 26;
      const cy = h / 2 + (this.mouse.y - 0.5) * 14;
      const R = Math.min(w, h) * 0.46;

      this._drawNebula(ctx, cx, cy, R);
      this._drawStars(ctx, w, h);
      this._drawArms(ctx, cx, cy, R);
      this._drawCore(ctx, cx, cy);
      this._drawRipples(ctx, cx, cy, R, dt);
    }

    _drawNebula(ctx, cx, cy, R) {
      const rot = this.time * 0.03;
      const blobs = [
        { dx: -0.35, dy: 0.1, r: 0.8, hue: "31, 87, 190" },
        { dx: 0.3, dy: -0.12, r: 0.7, hue: "20, 120, 255" },
        { dx: 0.05, dy: 0.35, r: 0.6, hue: "74, 108, 247" },
      ];
      for (let i = 0; i < blobs.length; i += 1) {
        const b = blobs[i];
        const angle = rot + i * 2.1;
        const bx = cx + Math.cos(angle) * b.dx * R;
        const by = cy + Math.sin(angle) * b.dy * R;
        const r = b.r * R;
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        const alpha = 0.10 + 0.05 * (0.5 + 0.5 * Math.sin(this.time * 0.6 + i));
        grad.addColorStop(0, "rgba(" + b.hue + ", " + alpha + ")");
        grad.addColorStop(1, "rgba(" + b.hue + ", 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _drawStars(ctx, w, h) {
      for (const s of this.stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(s.tw + this.time * s.twSpeed);
        const px = ((s.x + this.time * s.z * 0.008) % 1 + 1) % 1 * w;
        const py = s.y * h;
        const alpha = (0.25 + 0.6 * twinkle) * (s.z * 0.8 + 0.2);
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(px, py, s.size * s.z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawArms(ctx, cx, cy, R) {
      const rot = this.time * 0.055;
      for (const p of this.arms) {
        const angle = p.baseAngle + p.t * 4.4 + p.offset + rot * (0.6 + p.t * 0.7);
        const dist = R * (0.06 + p.t * 0.4);
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist * 0.92;
        const brightness = p.brightness * (0.55 + 0.45 * Math.sin(this.time * 0.9 + p.phase));
        const boost = 1 + this.intensity * 1.4;
        const alpha = Math.min(0.9, brightness * boost);
        const near = 1 - p.t;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = near > 0.7 ? "#dff0ff" : near > 0.4 ? "#4aa3ff" : "#1b5bb0";
        ctx.beginPath();
        ctx.arc(px, py, p.size * (0.7 + p.t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawCore(ctx, cx, cy) {
      const breath = 0.5 + 0.5 * Math.sin(this.time * 1.1);
      const pulse = 1 + this.intensity * 1.6;
      const r = (11 + breath * 4 + this.intensity * 10) * pulse;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      grad.addColorStop(0, "rgba(255, 255, 255, " + (0.75 + this.intensity * 0.25) + ")");
      grad.addColorStop(0.12, "rgba(159, 208, 255, " + (0.5 + this.intensity * 0.3) + ")");
      grad.addColorStop(0.4, "rgba(47, 127, 255, " + (0.22 + this.intensity * 0.2) + ")");
      grad.addColorStop(1, "rgba(47, 127, 255, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawRipples(ctx, cx, cy, R, dt) {
      for (let i = this.ripples.length - 1; i >= 0; i -= 1) {
        const rip = this.ripples[i];
        rip.r += (R * 0.22) * (0.6 + this.intensity) * dt * 4;
        rip.alpha -= dt * 1.1;
        if (rip.alpha <= 0 || rip.r > R * 1.15) {
          this.ripples.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, rip.alpha) * 0.5;
        ctx.strokeStyle = "#4aa3ff";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, rip.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  window.Galaxy = Galaxy;
})();
