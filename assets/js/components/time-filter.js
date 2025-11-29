---
permalink: /js/components/time-filter.js
layout: none
---

/**
 * Time Range Filter Component
 * Provides UI for filtering analytics data by time periods
 */

class TimeRangeFilter {
  constructor(containerId, analytics) {
    this.container = document.getElementById(containerId);
    this.analytics = analytics;
    this.currentRange = null;
    this.customStart = '';
    this.customEnd = '';
    
    this.render();
    this.bindEvents();
  }
  
  render() {
    this.container.innerHTML = `
      <div class="time-filter-container">
        <div class="filter-controls">
          <span class="filter-label">Time Range:</span>
          
          <!-- Preset ranges -->
          <div class="preset-buttons">
            <button class="time-range-btn" data-range="7">7 Days</button>
            <button class="time-range-btn" data-range="30">30 Days</button>
            <button class="time-range-btn" data-range="90">90 Days</button>
            <button class="time-range-btn" data-range="null">All Time</button>
          </div>
          
          <!-- Custom range -->
          <div class="custom-range-container">
            <span class="custom-label">Custom:</span>
            <input type="date" 
                   id="start-date" 
                   class="date-input">
            <span class="date-separator">to</span>
            <input type="date" 
                   id="end-date"
                   class="date-input">
            <button id="apply-custom" 
                    class="apply-button">
              Apply
            </button>
          </div>
        </div>
        
        <!-- Current selection display -->
        <div class="current-selection" id="current-selection">
          Current: All Time
        </div>
      </div>
    `;
  }
  
  bindEvents() {
    // Preset range buttons
    this.container.querySelectorAll('.time-range-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const range = e.target.dataset.range;
        this.setRange(range === 'null' ? null : parseInt(range));
      });
    });
    
    // Custom range inputs
    const startInput = this.container.querySelector('#start-date');
    const endInput = this.container.querySelector('#end-date');
    const applyBtn = this.container.querySelector('#apply-custom');
    
    startInput.addEventListener('change', (e) => {
      this.customStart = e.target.value;
    });
    
    endInput.addEventListener('change', (e) => {
      this.customEnd = e.target.value;
    });
    
    applyBtn.addEventListener('click', () => {
      this.applyCustomRange();
    });
  }
  
  setRange(days) {
    this.currentRange = days;
    this.analytics.setTimeRange(days);
    this.updateUI();
    this.dispatchEvent('rangeChanged', { range: days });
  }
  
  applyCustomRange() {
    if (!this.customStart || !this.customEnd) {
      alert('Please select both start and end dates');
      return;
    }
    
    const start = new Date(this.customStart).getTime() / 1000;
    const end = new Date(this.customEnd).getTime() / 1000 + 86400; // Add one day
    
    if (start >= end) {
      alert('Start date must be before end date');
      return;
    }
    
    this.currentRange = 'custom';
    this.analytics.setCustomTimeRange(start, end);
    this.updateUI();
    this.dispatchEvent('rangeChanged', { 
      range: 'custom', 
      start: start, 
      end: end 
    });
  }
  
  updateUI() {
    // Update button states
    this.container.querySelectorAll('.time-range-btn').forEach(btn => {
      const range = btn.dataset.range;
      const isActive = (range === 'null' && this.currentRange === null) ||
                      (range !== 'null' && parseInt(range) === this.currentRange);
      
      btn.className = `time-range-btn px-3 py-1 rounded text-sm transition ${
        isActive 
          ? 'bg-indigo-600 text-white' 
          : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
      }`;
    });
    
    // Update current selection display
    const display = this.container.querySelector('#current-selection');
    let text = 'Current: ';
    
    if (this.currentRange === null) {
      text += 'All Time';
    } else if (this.currentRange === 'custom') {
      text += `Custom Range (${this.customStart} to ${this.customEnd})`;
    } else {
      text += `Last ${this.currentRange} Days`;
    }
    
    display.textContent = text;
  }
  
  dispatchEvent(eventName, data) {
    const event = new CustomEvent(eventName, { detail: data });
    this.container.dispatchEvent(event);
  }
  
  // Public API
  getCurrentRange() {
    return this.analytics.getCurrentTimeRange();
  }
  
  reset() {
    this.setRange(null);
    this.customStart = '';
    this.customEnd = '';
    this.container.querySelector('#start-date').value = '';
    this.container.querySelector('#end-date').value = '';
  }
}

// Export to global scope
window.TimeRangeFilter = TimeRangeFilter;