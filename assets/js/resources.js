---
layout: none
permalink: /js/resources.js
---

window.resources = [
{% assign ps = "" | split: "" %}
{%- for p in site.nostrResources -%}
  {% if p.tags %}
    {% assign ps = ps | push: p %}
  {% endif %}
{%- endfor -%}
{%- for p in ps -%}
  {
    "title": "{{ p.title }}",
    "permalink": "{{ p.permalink }}",
    "web": "{{ p.web }}",
    "github": "{{ p.github }}",
    "authorNPub": "{{ p.authorNPub }}",
    "instances": {{ p.instances | jsonify }},
    "tags": {{ p.tags | jsonify }},
    "platforms": {{ p.platforms | jsonify }},
    "nips": {{ p.nips | jsonify }},
    "license": "{{ p.license }}"
  }{% unless forloop.last %},{% endunless %}
{%- endfor -%}
]
window.activeTags = []
{% assign p = site.nostrResources | map: "platforms" %}
{% assign t = site.nostrResources | map: "tags" %}
{% assign n = site.nostrResources | map: "nips" %}
window.allTags = {{ p | concat: t | concat: n | compact | uniq | jsonify }}

window.addEventListener("load", () => {
  console.log('Resources page loaded')
  
  initializeElements()
  setupTabs()
  setupViewToggle()
  setupMobileFilterToggle()
  update()
  setupSearch()
  updateResultsCount()
  
  // Debug: Check results container
  const resultsContainer = document.getElementById('results')
  if (resultsContainer) {
    console.log('Results container found:', resultsContainer)
    console.log('Results count:', resultsContainer.children.length)
  } else {
    console.error('Results container not found!')
  }
})

window.currentCategory = "all"
window.currentView = "grid"

// Initialize after DOM loads
let categoryFilters, platformFilters, nipFilters, archFilters, activeFiltersDiv, activeFilterTags

function initializeElements() {
  categoryFilters = document.getElementById("category-filters")
  platformFilters = document.getElementById("platform-filters") 
  nipFilters = document.getElementById("nip-filters")
  archFilters = document.getElementById("arch-filters")
  activeFiltersDiv = document.getElementById("active-filters")
  activeFilterTags = document.getElementById("active-filter-tags")
  
  // Check if enhanced filters are available
  const hasEnhancedFilters = categoryFilters || platformFilters || nipFilters || archFilters
  if (!hasEnhancedFilters) {
    // Add class to body to show legacy system
    document.body.classList.add('no-enhanced-filters')
    // Show the old toggle system
    const toggles = document.getElementById("toggles")
    if (toggles) {
      toggles.style.display = 'flex'
    }
  }
}

function setupSearch() {
  const searchInput = document.getElementById("searchInput")
  if (searchInput) {
    searchInput.addEventListener("input", debounce((e) => {
      const searchTerm = e.target.value.toLowerCase()
      filterResults(searchTerm)
    }, 300))
  }
}

function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

function filterResults(searchTerm) {
  const results = document.querySelectorAll('.result')
  results.forEach(result => {
    const title = result.querySelector('.name').textContent.toLowerCase()
    const description = result.querySelector('.dev').textContent.toLowerCase()
    const isVisible = title.includes(searchTerm) || description.includes(searchTerm)
    
    if (window.activeTags.length === 0) {
      result.style.display = isVisible ? 'block' : 'none'
    } else {
      result.style.display = isVisible && result.matches('.' + window.activeTags.join('.')) ? 'block' : 'none'
    }
  })
  updateResultsCount()
}

function clickTag(t) {
  if (window.activeTags.includes(t)) {
    window.activeTags.splice(window.activeTags.indexOf(t), 1)
  } else {
    window.activeTags.push(t)
  }
  console.log(window.activeTags)
  updateFilterCountBadge()
  update()
}

function updateAvailableTags() {
  if (window.activeTags.length) {
    window.availableTags = []
    function addFrom(name) {
      window.availableTags.push(
        ...new Set(
          window.resources.filter(st => {
            const t = (st.tags || [])
              .concat(st.platforms || [])
              .concat(st.nips || [])
            return window
              .activeTags
              .every( it => t.includes(it) )
          })
          .map(it => it[name] || [])
          .flat()
        )
      )
    }
    addFrom('platforms')
    addFrom('tags')
    addFrom('nips')
  } else {
    window.availableTags = window.allTags
  }
}

function addToggle(name, cls) {
  const btn = document.createElement("div")
  btn.setAttribute("class", `tag ${name} ${cls}`)
  btn.setAttribute("onclick", `clickTag('${name}')`)
  btn.innerHTML = name
  toggles.append(btn)
}

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn')
  if (tabBtns.length === 0) return
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Remove active class from all tabs
      tabBtns.forEach(b => b.classList.remove('active'))
      // Add active class to clicked tab
      e.target.classList.add('active')
      // Update current category
      window.currentCategory = e.target.dataset.category || 'all'
      // Update display
      update()
    })
  })
}

function setupViewToggle() {
  const viewBtns = document.querySelectorAll('.view-btn')
  if (viewBtns.length === 0) return
  
  viewBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Remove active class from all view buttons
      viewBtns.forEach(b => b.classList.remove('active'))
      // Add active class to clicked button
      e.target.classList.add('active')
      // Update current view
      window.currentView = e.target.dataset.view || 'grid'
      // Toggle view class on results container
      const resultsContainer = document.getElementById('results')
      if (resultsContainer) {
        resultsContainer.classList.remove('grid-view', 'list-view')
        resultsContainer.classList.add(`${window.currentView}-view`)
      }
    })
  })
}

function setupMobileFilterToggle() {
  const toggleBtn = document.getElementById('mobile-filter-toggle')
  const sidebar = document.getElementById('filters-sidebar')
  
  if (!toggleBtn || !sidebar) return
  
  // Toggle sidebar visibility
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('active')
    document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : ''
  })
  
  // Close sidebar when clicking the close button (::before pseudo-element)
  sidebar.addEventListener('click', (e) => {
    const rect = sidebar.getBoundingClientRect()
    // Check if click was in the top area (close button)
    if (e.clientY < rect.top + 60) {
      sidebar.classList.remove('active')
      document.body.style.overflow = ''
    }
  })
  
  // Close sidebar when window is resized to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('active')
      document.body.style.overflow = ''
    }
  })
  
  // Update filter count badge
  updateFilterCountBadge()
}

function updateFilterCountBadge() {
  const countBadge = document.getElementById('mobile-filter-count')
  if (!countBadge) return
  
  const activeCount = window.activeTags ? window.activeTags.length : 0
  if (activeCount > 0) {
    countBadge.textContent = activeCount
    countBadge.style.display = 'inline-block'
  } else {
    countBadge.style.display = 'none'
  }
}

function updateResultsCount() {
  const totalResults = window.resources.length
  const allResults = document.querySelectorAll('.result')
  let visibleResults = 0
  
  allResults.forEach(result => {
    const computedStyle = window.getComputedStyle(result)
    if (computedStyle.display !== 'none') {
      visibleResults++
    }
  })
  
  const activeFiltersCount = window.activeTags.length
  const searchTerm = document.getElementById('searchInput')?.value || ''
  
  let countText
  if (activeFiltersCount > 0 || searchTerm) {
    countText = `${visibleResults}/${totalResults} resources`
    if (activeFiltersCount > 0) countText += ` (${activeFiltersCount} filters)`
    if (searchTerm) countText += ` (searching: "${searchTerm}")`
  } else {
    countText = `${totalResults} resources`
  }
    
  const countElement = document.getElementById('results-count')
  if (countElement) {
    countElement.textContent = countText
  }
}

function clearAllFilters() {
  window.activeTags = []
  document.getElementById('searchInput').value = ''
  update()
  updateResultsCount()
}

function updateActiveFilters() {
  if (!activeFiltersDiv || !activeFilterTags) return
  
  if (window.activeTags.length > 0) {
    activeFiltersDiv.style.display = 'block'
    activeFilterTags.innerHTML = window.activeTags.map(tag => 
      `<span class="active-filter-tag">
        ${tag}
        <button class="remove-filter" onclick="removeFilter('${tag}')">&times;</button>
      </span>`
    ).join('')
  } else {
    activeFiltersDiv.style.display = 'none'
  }
}

function removeFilter(tag) {
  const index = window.activeTags.indexOf(tag)
  if (index > -1) {
    window.activeTags.splice(index, 1)
    update()
    updateResultsCount()
  }
}

function update() {
  updateAvailableTags()
  
  // Check if we should use the new filter system or legacy toggle system
  if (categoryFilters || platformFilters || nipFilters || archFilters) {
    // New filter system
    updateFilterSections()
    updateActiveFilters()
    
    // Apply filters to all results
    const allResults = document.querySelectorAll('.result')
    allResults.forEach(result => {
      const resourceTags = Array.from(result.classList).filter(cls => cls !== 'result')
      
      // Check category filter
      const matchesCategory = window.currentCategory === 'all' || resourceTags.includes(window.currentCategory)
      
      // Check tag filters
      const matchesTags = window.activeTags.length === 0 || 
        window.activeTags.every(tag => resourceTags.includes(tag))
      
      // Show/hide based on filters
      result.style.display = (matchesCategory && matchesTags) ? 'block' : 'none'
    })
  } else {
    // Legacy toggle system
    const toggles = document.getElementById("toggles")
    if (toggles) {
      toggles.replaceChildren()
      checkForLegacyToggleSystem()
    }
  }
  
  // Apply search filter if there's a search term
  const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || ''
  if (searchTerm) {
    filterResults(searchTerm)
  } else {
    updateResultsCount()
  }
}

function updateFilterSections() {
  // Update category filters
  updateFilterSection(categoryFilters, ['client', 'relay', 'library', 'tool'], 'category')
  
  // Update platform filters with Font Awesome SVG icons (FA5 syntax)
  const platformsWithIcons = {
    web: `{% fa_svg fas.fa-globe %}`,
    android: `{% fa_svg fab.fa-android %}`,
    ios: `{% fa_svg fab.fa-apple %}`,
    desktop: `{% fa_svg fas.fa-desktop %}`,
    linux: `{% fa_svg fab.fa-linux %}`,
    windows: `{% fa_svg fab.fa-windows %}`,
    macos: `{% fa_svg fab.fa-apple %}`,
    terminal: `{% fa_svg fas.fa-terminal %}`
  }
  updateFilterSection(platformFilters, Object.keys(platformsWithIcons), 'platform', platformsWithIcons)
  
  // Update NIP filters
  const nips = window.allTags.filter(tag => tag.startsWith('NIP') || tag.match(/^\d+$/))
  updateFilterSection(nipFilters, nips, 'nip')
  
  // Update architecture filters (if any)
  const archs = ['x86_64', 'arm64', 'armv7', 'universal']
  updateFilterSection(archFilters, archs, 'arch')
}

function updateFilterSection(container, items, type, icons = {}) {
  if (!container) return
  
  container.innerHTML = items.map(item => {
    const isActive = window.activeTags.includes(item)
    const isAvailable = window.availableTags.includes(item)
    const count = countResourcesWithTag(item)
    const icon = icons[item] || ''
    
    if (count === 0) return ''
    
    return `<div class="filter-tag ${isActive ? 'active' : ''}" onclick="clickTag('${item}')">
      ${icon ? `<span class="icon">${icon}</span>` : ''}
      <span>${item}</span>
      <span class="count">${count}</span>
    </div>`
  }).filter(Boolean).join('')
}

function countResourcesWithTag(tag) {
  return window.resources.filter(resource => {
    const allTags = (resource.tags || [])
      .concat(resource.platforms || [])
      .concat(resource.nips || [])
    return allTags.includes(tag)
  }).length
}

// Backward compatibility: if old toggle container exists, use original system
function checkForLegacyToggleSystem() {
  const toggles = document.getElementById("toggles")
  if (toggles && !categoryFilters) {
    // Use original toggle system
    window.activeTags.forEach(t => {
      addToggle(t, 'active')
    })
    window.availableTags.forEach(t => {
      if (window.activeTags.includes(t)) return
      addToggle(t, 'available')
    })
    window.allTags.forEach(t => {
      if (window.activeTags.includes(t) || window.availableTags.includes(t)) return
      addToggle(t, 'unavailable')
    })
    
    // Apply legacy filtering
    if (window.activeTags.length) {
      document.querySelectorAll('.result').forEach(it => it.style.display = 'none')
      document.querySelectorAll(`.result.${window.activeTags.join(".")}`).forEach(it => it.style.display = 'block')
    } else {
      document.querySelectorAll('.result').forEach(it => it.style.display = 'block')
    }
  }
}

function addToggle(name, cls) {
  const toggles = document.getElementById("toggles")
  if (!toggles) return
  
  const btn = document.createElement("div")
  btn.setAttribute("class", `tag ${name} ${cls}`)
  btn.setAttribute("onclick", `clickTag('${name}')`)
  btn.innerHTML = name
  toggles.append(btn)
}
