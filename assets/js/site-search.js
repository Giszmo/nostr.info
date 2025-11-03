// Reusable site-wide search dispatcher
(function(){
  // Simple debounce
  function debounce(fn, wait){
    let t;
    return function(){
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(()=>fn.apply(null,args), wait);
    }
  }

  function getQuery(el){
    return (el && el.value) ? el.value.trim() : '';
  }

  function applyToResources(q){
    // If resources page provides a search input, populate it and trigger input
    const r = document.getElementById('searchInput');
    if(r){
      r.value = q;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // As a fallback, if window.resources exists and a filtering function is exposed, try to call it
    if(window.performResourcesSearch){
      try{ window.performResourcesSearch(q); return true; } catch(e){}
    }
    return false;
  }

  function applyToRelays(q){
    if(window.applyRelaySearch){
      try{ window.applyRelaySearch(q); return true; } catch(e){}
    }
    // Try to find relay cards and filter them directly
    const cards = document.querySelectorAll('.relay-card');
    if(cards && cards.length){
      const qq = q.toLowerCase();
      cards.forEach(c=>{
        const visible = qq === '' || c.textContent.toLowerCase().indexOf(qq) !== -1;
        c.style.display = visible ? '' : 'none';
      });
      return true;
    }
    return false;
  }

  function applyToStatistics(q){
    if(window.applyStatisticsSearch){
      try{ window.applyStatisticsSearch(q); return true; } catch(e){}
    }
    // Generic fallback: hide elements with .searchable (if present)
    const items = document.querySelectorAll('.searchable');
    if(items && items.length){
      const qq = q.toLowerCase();
      items.forEach(it=>{
        it.style.display = qq === '' || it.textContent.toLowerCase().indexOf(qq) !== -1 ? '' : 'none';
      });
      return true;
    }
    return false;
  }

  function dispatchSearch(q){
    // Order: resources, relays, statistics — whichever matches current page
    if(document.querySelector('.resources-container')){
      return applyToResources(q);
    }
    if(document.querySelector('.relays-container')){
      return applyToRelays(q);
    }
    if(document.querySelector('.statistics-container')){
      return applyToStatistics(q);
    }
    // If none matched, try all
    return applyToResources(q) || applyToRelays(q) || applyToStatistics(q);
  }

  const input = document.getElementById('global-search');
  if(!input) return;

  const handler = debounce(function(e){
    const q = getQuery(input);
    dispatchSearch(q);
  }, 250);

  input.addEventListener('input', handler, false);

  // Support Enter key: if on other page, navigate to resources and pass query via hash
  input.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      const q = getQuery(input);
      // If we're not on a page that handles search, go to /resources/ and focus search
      if(!document.querySelector('.resources-container')){
        // encode query in hash so resources page can pick it up
        location.href = '/resources/#q=' + encodeURIComponent(q);
      }
    }
  }, false);

  // On load, support prefilled query in URL hash for resources page
  if(document.querySelector('.resources-container')){
    const h = location.hash || '';
    const m = h.match(/q=([^&]+)/);
    if(m){
      const q = decodeURIComponent(m[1]);
      const r = document.getElementById('searchInput');
      if(r){ r.value = q; r.dispatchEvent(new Event('input', { bubbles: true })); }
      // also set header input
      input.value = q;
    }
  }
})();
