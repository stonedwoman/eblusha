// Lock viewport zoom on mobile browsers (iOS/Safari quirks safe)
(function(){
  try{
    // prevent double-tap zoom
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function(e){
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    }, { passive: false });

    // prevent pinch zoom
    document.addEventListener('gesturestart', function(e){ e.preventDefault(); }, { passive:false });
    document.addEventListener('gesturechange', function(e){ e.preventDefault(); }, { passive:false });
    document.addEventListener('gestureend', function(e){ e.preventDefault(); }, { passive:false });

    // extra: set touch-action to manipulation to hint no zoom
    document.documentElement.style.touchAction = 'manipulation';
    document.body.style.touchAction = 'manipulation';
  }catch(_){/* no-op */}
})();



