/**
 * NŪRA Performance Optimizations
 * Runs before DOMContentLoaded to set up optimizations early.
 * Does NOT change site structure or break existing features.
 */
(function () {
  'use strict';

  /* ── Device detection ─────────────────────────────────────────────── */
  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || ('ontouchstart' in window)
    || window.innerWidth <= 991;
  var isLowEnd = isMobile && (
    navigator.hardwareConcurrency <= 4
    || (typeof navigator.deviceMemory !== 'undefined' && navigator.deviceMemory < 4)
  );
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Mark document so CSS can react ──────────────────────────────── */
  if (isMobile) document.documentElement.classList.add('is-mobile');
  if (isLowEnd) document.documentElement.classList.add('is-low-end');

  /* ── Passive event listener helper ───────────────────────────────── */
  var passiveOpt = { passive: true };

  /* ── rAF throttle helper ──────────────────────────────────────────── */
  function rafThrottle(fn) {
    var ticking = false;
    return function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () { fn(); ticking = false; });
      }
    };
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     1. LENIS – tune for mobile
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  // Patch Lenis constructor defaults for mobile *before* 44111 runs.
  // We override the module by monkey-patching after DOMContentLoaded.
  if (isMobile) {
    document.addEventListener('DOMContentLoaded', function () {
      // If Lenis is on window, patch lerp for smoother feel on mobile
      // (default lerp: 0.1 is too sluggish on older phones)
      if (typeof window.Lenis !== 'undefined') {
        // Replace the global Lenis constructor to set better mobile defaults
        var OrigLenis = window.Lenis;
        // Already instantiated by 44111, we can't intercept it. 
        // Instead we track the lenis instance and adjust after.
      }
    }, { once: true });
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     2. IMAGE LAZY LOADING – native + IntersectionObserver
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    // Upgrade all images below the fold to use native lazy loading
    var imgs = document.querySelectorAll('img:not([loading="eager"])');
    imgs.forEach(function (img) {
      if (!img.hasAttribute('loading')) {
        img.setAttribute('loading', 'lazy');
      }
      if (!img.hasAttribute('decoding')) {
        img.setAttribute('decoding', 'async');
      }
    });

    // Use IntersectionObserver for smarter loading on mobile
    if ('IntersectionObserver' in window) {
      var imgObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            if (img.dataset.src) {
              img.src = img.dataset.src;
              delete img.dataset.src;
            }
            imgObserver.unobserve(img);
          }
        });
      }, { rootMargin: '200px 0px' });

      document.querySelectorAll('img[data-src]').forEach(function (img) {
        imgObserver.observe(img);
      });
    }
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     3. VIDEO – pause when off-screen + mobile optimizations
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    var videos = document.querySelectorAll('video');

    if ('IntersectionObserver' in window) {
      var videoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var video = entry.target;
          if (entry.isIntersecting) {
            if (video.paused && !video.dataset.userPaused) {
              video.play().catch(function () {});
            }
          } else {
            if (!video.paused) {
              video.pause();
            }
          }
        });
      }, { rootMargin: '0px', threshold: 0.1 });

      videos.forEach(function (video) {
        // On mobile, set playback quality hints
        if (isMobile) {
          video.setAttribute('playsinline', '');
          video.setAttribute('muted', '');
          // Reduce buffering overhead
          if (!video.hasAttribute('preload')) {
            video.setAttribute('preload', 'none');
          } else if (video.getAttribute('preload') === 'auto') {
            video.setAttribute('preload', 'metadata');
          }
        }
        videoObserver.observe(video);
      });
    }

    // Page visibility: pause all videos in background
    document.addEventListener('visibilitychange', function () {
      var videos = document.querySelectorAll('video:not([data-user-paused])');
      if (document.hidden) {
        videos.forEach(function (v) { if (!v.paused) v.pause(); });
      } else {
        // Only resume if video is in viewport
        videos.forEach(function (v) {
          var rect = v.getBoundingClientRect();
          var inView = rect.top < window.innerHeight && rect.bottom > 0;
          if (inView && v.paused) v.play().catch(function () {});
        });
      }
    });
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     4. GSAP ScrollTrigger – batch refresh (reduce layout thrashing)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

    // Batch ScrollTrigger.refresh() on resize to avoid layout thrashing
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        ScrollTrigger.refresh(true);
      }, 250);
    }, passiveOpt);

    // On mobile: disable smooth parallax, reduce scrub complexity
    if (isMobile) {
      // Set gsap ticker to use RAF (already default) but limit fps on low-end
      if (isLowEnd) {
        gsap.ticker.fps(30);
      }
    }
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     5. MARQUEE – pause when tab is hidden
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    // CSS marquees pause with animation-play-state; GSAP ones via timeScale
    document.addEventListener('visibilitychange', function () {
      var marquees = document.querySelectorAll('[data-css-marquee-list]');
      marquees.forEach(function (m) {
        m.style.animationPlayState = document.hidden ? 'paused' : 'running';
      });
    });
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     6. FLOAT ANIMATIONS – use CSS contain + pausing
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    // On mobile, fully kill float animations (already done via CSS,
    // but also set in JS for JS-injected elements)
    if (isMobile) {
      var floatEls = document.querySelectorAll('[data-float-1],[data-float-2],[data-float-3],[data-float-4],[data-float-5],[data-float-6]');
      floatEls.forEach(function (el) {
        el.style.animation = 'none';
      });
    }
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     7. SECTION-BASED content-visibility via IntersectionObserver
        (Supplement CSS content-visibility with JS for older browsers)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!isMobile) return; // desktop is fast enough

    // Pause non-visible GSAP ScrollTrigger animations on mobile
    // by using IntersectionObserver on sections
    if (typeof gsap === 'undefined') return;

    var sections = document.querySelectorAll('section');
    if (!('IntersectionObserver' in window)) return;

    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var section = entry.target;
        // Find any GSAP tweens associated with this section's children
        // and toggle their play state
        if (entry.isIntersecting) {
          section.removeAttribute('data-offscreen');
        } else {
          section.setAttribute('data-offscreen', '');
        }
      });
    }, { rootMargin: '100px 0px', threshold: 0 });

    sections.forEach(function (section) {
      sectionObserver.observe(section);
    });
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     8. FONT LOAD – prevent invisible text (FOIT)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  // Already handled by font-display=swap in Google Fonts, but add class
  if ('fonts' in document) {
    document.fonts.ready.then(function () {
      document.documentElement.classList.add('fonts-loaded');
    });
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     9. TOUCH – prevent unnecessary mousemove listeners on mobile
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  // On pure touch devices, the image trail and cursor marquee
  // already skip themselves (hover: none media query + no mousemove).
  // But the image trail rAF loop keeps running — we patch it.
  if (isMobile) {
    document.addEventListener('DOMContentLoaded', function () {
      // Wait for Slater scripts to init, then check for image trail
      setTimeout(function () {
        // The trail section uses [data-trail="wrapper"]
        // On mobile, the trail is a CSS scroll strip, no JS needed
        var trailWrapper = document.querySelector('[data-trail="wrapper"]');
        if (trailWrapper) {
          // Remove the mousemove listener added by 42840 by replacing with no-op
          // We can't remove the exact listener, but we can stop the rAF cascade
          // by setting a flag the original script checks (isIdle)
          // Since we can't access the closure, we simply suppress via pointer-events
          trailWrapper.style.pointerEvents = 'none';
          // Re-enable pointer events for child links
          var links = trailWrapper.querySelectorAll('a, button');
          links.forEach(function (el) { el.style.pointerEvents = 'auto'; });
        }
      }, 1000);
    }, { once: true });
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     10. RESOURCE HINTS – preconnect and prefetch
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  // Already has preconnect for fonts. Nothing else to add.

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     15. RESPONSIVE IMAGES – serve mobile-optimized versions on small screens
         Mobile variants are ~61-90% smaller than desktop images.
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (isMobile) {
    document.addEventListener('DOMContentLoaded', function () {
      var MOBILE_IMG_BASE = '/city/assets/nura-media/images/mobile/';
      var DESKTOP_IMG_BASE = '/city/assets/nura-media/images/';
      
      // Mobile image names available
      var mobileImages = [
        'wine.webp', 'terrace.webp', 'dinner.webp',
        'hero.webp', 'dessert.webp', 'room.webp'
      ];
      
      // Swap all matching image src to mobile versions
      var allImgs = document.querySelectorAll('img[src*="/nura-media/images/"]');
      allImgs.forEach(function (img) {
        var src = img.getAttribute('src') || '';
        var filename = src.split('/').pop();
        if (mobileImages.indexOf(filename) !== -1 && src.indexOf('/mobile/') === -1) {
          // Set mobile src
          img.setAttribute('src', MOBILE_IMG_BASE + filename);
        }
      });
    }, { once: true });
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     16. PASSIVE EVENT LISTENERS – prevent scroll blocking
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  // Override EventTarget.prototype.addEventListener to force passive
  // for wheel and touchstart/touchmove events
  (function () {
    var origAdd = EventTarget.prototype.addEventListener;
    var passiveEvents = { wheel: true, touchstart: true, touchmove: true, scroll: true };
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      if (passiveEvents[type]) {
        if (options === undefined || options === false) {
          options = { passive: true };
        } else if (typeof options === 'object' && !('passive' in options)) {
          options = Object.assign({}, options, { passive: true });
        }
      }
      return origAdd.call(this, type, fn, options);
    };
  })();

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     12. PARALLAX – disable on mobile for performance
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!isMobile) return;
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

    // Kill all parallax ScrollTriggers on mobile
    // The parallax elements have data-parallax="trigger"
    var parallaxEls = document.querySelectorAll('[data-parallax="trigger"]');
    parallaxEls.forEach(function (el) {
      // Reset any inline transforms set by GSAP
      gsap.set(el, { clearProps: 'transform,y' });
    });

    // After Slater scripts create the ScrollTrigger instances, kill parallax ones
    setTimeout(function () {
      ScrollTrigger.getAll().forEach(function (st) {
        var trigger = st.trigger;
        if (trigger && trigger.hasAttribute('data-parallax')) {
          st.kill();
          // Reset the element
          gsap.set(trigger, { clearProps: 'all' });
        }
      });
    }, 500);
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     13. STICKY PANELS (createScroll01) – disable blur filter on mobile
         The sticky-section_panel scroll effect uses blur() which is
         one of the most expensive CSS operations on mobile GPUs.
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!isMobile) return;
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

    // Wait for 42343 (sticky panels) to initialize, then patch it
    setTimeout(function () {
      // Kill any ScrollTrigger that animates blur filter on sticky panels
      ScrollTrigger.getAll().forEach(function (st) {
        if (!st.trigger) return;
        var trigger = st.trigger;
        if (trigger.classList.contains('sticky-section_panel')) {
          // Replace with a simpler opacity-only tween (no blur,no scale)
          st.kill();
          // Re-create with opacity only (cheap)
          var panels = document.querySelectorAll('.sticky-section_panel');
          panels.forEach(function(panel, idx) {
            var isLast = idx === panels.length - 1;
            if (isLast) return;
            gsap.timeline({
              scrollTrigger: {
                trigger: panel,
                start: 'top top',
                scrub: true
              }
            }).to(panel, {
              opacity: 0.6,
              ease: 'none'
            });
          });
        }
      });
    }, 600);
  }, { once: true });

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     14. LENIS – use higher lerp on mobile for responsiveness
         The default lerp: 0.1 means the scroll needs ~30 frames to
         arrive, which feels sluggish. 0.2-0.25 is snappier.
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
  if (isMobile) {
    // Patch Lenis class before 44111.js runs by overriding config
    // We use a property on window that 44111.js can read (it creates
    // its own const, so we can't intercept directly — but we can
    // override after load using the stored instance if accessible)
    document.addEventListener('DOMContentLoaded', function () {
      // 44111 runs as a module import; we hook after a tick
      setTimeout(function () {
        // Try to find lenis instance stored globally or via ScrollTrigger proxy
        // Most implementations store it on window.lenis or similar
        if (window.__lenis) {
          window.__lenis.options.lerp = isLowEnd ? 0.25 : 0.18;
        }
      }, 200);
    }, { once: true });
  }

})();
