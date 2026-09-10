(function(){
  'use strict';

  var STORAGE_KEY = 'slugPlanner.v1';
  var PALETTE = ['#cfd026','#2b4bd6','#e5352b','#ff7a1a','#9b3fd6','#0f8f7a','#e83e8c','#171a12','#157a3a','#6b4c1e'];
  var HOUR_START = 7, HOUR_END = 22;
  var PX_PER_HOUR = 32;
  var DAYS = ['sun','mon','tue','wed','thu','fri','sat'];

  var LOADING_LINES = [
    'Manifesting the perfect schedule for you this quarter ✨',
    'Making Plan A. And Plan B. And maybe Plan C.',
    'Checking if an 8 AM is really necessary...',
    'Performing schedule Tetris...',
    "Let's make your quarter less bananas 🍌"
  ];

  var data = null;
  var appState = null;
  var ui = { drawerOpen:false, drawerSubject:'', drawerSearch:'', chooser:null, dragClassNbr:null };
  var loadingRotation = { order: [], index: 0, timer: null };

  function el(id){ return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', init);

  function init(){
    wireStaticEvents();
    loadData();
  }

  function wireStaticEvents(){
    el('retry-btn').addEventListener('click', loadData);
    el('add-class-btn').addEventListener('click', openDrawer);
    el('drawer-close').addEventListener('click', closeDrawer);
    el('drawer-dim').addEventListener('click', closeDrawer);
    el('subject-select').addEventListener('change', function(e){ ui.drawerSubject = e.target.value; renderDrawerList(); });
    el('search-input').addEventListener('input', function(e){ ui.drawerSearch = e.target.value; renderDrawerList(); });
    el('term-select').addEventListener('change', function(e){
      appState.selectedTerm = toInt(e.target.value);
      save();
      renderClassBank();
      if(ui.drawerOpen){ renderSubjectSelect(); renderDrawerList(); }
    });

    el('plan-prev').addEventListener('click', function(){ navigatePlan(-1); });
    el('plan-next').addEventListener('click', function(){ navigatePlan(1); });
    el('plan-add').addEventListener('click', addPlan);
    el('plan-duplicate').addEventListener('click', duplicatePlan);
    el('plan-delete').addEventListener('click', deleteOrClearPlan);

    var nameEl = el('plan-name');
    nameEl.addEventListener('blur', function(){
      var plan = currentPlan();
      if(!plan) return;
      var text = nameEl.textContent.trim();
      plan.name = text || plan.name;
      nameEl.textContent = plan.name;
      save();
      renderPlanArea();
    });
    nameEl.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); nameEl.blur(); }
    });

    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){
        if(ui.chooser){ closeChooser(); }
        else if(ui.drawerOpen){ closeDrawer(); }
      }
    });

    document.addEventListener('dragstart', function(e){
      var card = e.target.closest && e.target.closest('.lecture-card[draggable="true"]');
      if(!card) return;
      var classNbr = Number(card.dataset.classNbr);
      ui.dragClassNbr = classNbr;
      try{ e.dataTransfer.setData('text/plain', String(classNbr)); }catch(err){}
      e.dataTransfer.effectAllowed = 'copy';
      el('calendar').classList.add('armed');
    });
    document.addEventListener('dragend', function(){
      el('calendar').classList.remove('armed');
      ui.dragClassNbr = null;
    });

    var calendar = el('calendar');
    calendar.addEventListener('dragover', function(e){ e.preventDefault(); });
    calendar.addEventListener('drop', function(e){
      e.preventDefault();
      var classNbr = ui.dragClassNbr;
      el('calendar').classList.remove('armed');
      ui.dragClassNbr = null;
      if(classNbr == null) return;
      addLectureToCurrentPlan(classNbr);
    });

    document.addEventListener('dblclick', function(e){
      var card = e.target.closest && e.target.closest('.lecture-card[draggable="true"]');
      if(card){ addLectureToCurrentPlan(Number(card.dataset.classNbr)); }
    });

    document.addEventListener('click', function(e){
      var t = e.target;

      var removeBtn = t.closest && t.closest('.block-remove');
      if(removeBtn){
        var cn1 = Number(removeBtn.dataset.remove);
        var plan1 = currentPlan();
        delete plan1.picks[cn1];
        save(); renderPlanArea(); renderClassBank();
        return;
      }

      var chipBtn = t.closest && t.closest('.block-chip');
      if(chipBtn){
        var cn2 = Number(chipBtn.dataset.choose);
        openChooser(cn2, chipBtn.closest('.calendar-block'));
        return;
      }

      var bankRemove = t.closest && t.closest('.bank-remove');
      if(bankRemove){
        removeCourseFromBank(bankRemove.dataset.course);
        return;
      }

      var drawerRow = t.closest && t.closest('.drawer-course:not(.drawer-course-added)');
      if(drawerRow){
        addCourseToBank(drawerRow.dataset.course);
        return;
      }

      var popOption = t.closest && t.closest('.popover-option');
      if(popOption && ui.chooser){
        var sn = Number(popOption.dataset.section);
        var plan2 = currentPlan();
        plan2.picks[ui.chooser.classNbr] = sn;
        save(); closeChooser(); renderPlanArea(); renderClassBank();
        return;
      }

      var popLater = t.closest && t.closest('[data-later]');
      if(popLater && ui.chooser){ closeChooser(); return; }

      if(t.classList && t.classList.contains('popover-backdrop')){ closeChooser(); return; }
    });
  }

  function loadData(){
    showLoading();
    fetch('api/schedule')
      .then(function(res){
        if(!res.ok){ return res.json().catch(function(){ return {}; }).then(function(j){ throw new Error(j.error || ('Failed to load schedule (' + res.status + ')')); }); }
        return res.json();
      })
      .then(function(json){
        buildIndexes(json);
        if(data.terms.length === 0){
          throw new Error('No quarters are available right now.');
        }
        appState = loadPersisted();
        renderGutter();
        showApp();
        renderAll();
      })
      .catch(function(err){
        showError(err.message || 'Something went wrong loading the schedule.');
      });
  }

  function shuffle(arr){
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function startLoadingRotation(){
    stopLoadingRotation();
    loadingRotation.order = shuffle(LOADING_LINES);
    loadingRotation.index = 0;
    var textEl = el('loading-text');
    textEl.textContent = loadingRotation.order[0];
    textEl.classList.remove('loading-text-fade');
    loadingRotation.timer = setInterval(function(){
      loadingRotation.index = (loadingRotation.index + 1) % loadingRotation.order.length;
      textEl.classList.add('loading-text-fade');
      setTimeout(function(){
        textEl.textContent = loadingRotation.order[loadingRotation.index];
        textEl.classList.remove('loading-text-fade');
      }, 180);
    }, 2200);
  }

  function stopLoadingRotation(){
    if(loadingRotation.timer){ clearInterval(loadingRotation.timer); loadingRotation.timer = null; }
  }

  function showLoading(){
    el('loading-screen').hidden = false;
    el('error-screen').hidden = true;
    el('app').hidden = true;
    startLoadingRotation();
  }
  function showError(msg){
    stopLoadingRotation();
    el('loading-screen').hidden = true;
    el('error-screen').hidden = false;
    el('app').hidden = true;
    el('error-message').textContent = msg;
  }
  function showApp(){
    stopLoadingRotation();
    el('loading-screen').hidden = true;
    el('error-screen').hidden = true;
    el('app').hidden = false;
  }

  /* ---------------- data indexing ---------------- */

  function toInt(v){
    if(v === null || v === undefined || v === '') return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }
  function toStr(v){ return (v === null || v === undefined) ? '' : String(v); }

  function buildIndexes(json){
    var terms = (json.terms || []).map(function(t){
      return { term_code: toInt(t.term_code), term_name: t.term_name || '', is_current: !!t.is_current };
    });
    var classes = (json.classes || []).map(normalizeClass);
    var sections = (json.sections || []).map(normalizeSection);

    var classesByNbr = new Map();
    classes.forEach(function(c){ classesByNbr.set(c.class_nbr, c); });

    var sectionsByParent = new Map();
    var sectionsByNbr = new Map();
    sections.forEach(function(s){
      sectionsByNbr.set(s.section_nbr, s);
      if(!sectionsByParent.has(s.parent_class_nbr)) sectionsByParent.set(s.parent_class_nbr, []);
      sectionsByParent.get(s.parent_class_nbr).push(s);
    });

    var courseMapByTerm = new Map();
    classes.forEach(function(c){
      if(!courseMapByTerm.has(c.term_code)) courseMapByTerm.set(c.term_code, new Map());
      var m = courseMapByTerm.get(c.term_code);
      if(!m.has(c.course)) m.set(c.course, { course: c.course, title: c.title, subject: c.subject, catalog_nbr: c.catalog_nbr, lectures: [] });
      m.get(c.course).lectures.push(c);
    });

    data = { terms: terms, classes: classes, sections: sections, classesByNbr: classesByNbr, sectionsByParent: sectionsByParent, sectionsByNbr: sectionsByNbr, courseMapByTerm: courseMapByTerm };
  }

  function normalizeClass(c){
    var extra = [];
    if(c.extra_meetings){
      try{
        var parsed = typeof c.extra_meetings === 'string' ? JSON.parse(c.extra_meetings) : c.extra_meetings;
        if(Array.isArray(parsed)) extra = parsed;
      }catch(e){ extra = []; }
    }
    return {
      term_code: toInt(c.term_code),
      class_nbr: toInt(c.class_nbr),
      subject: c.subject || '',
      subject_name: c.subject_name || '',
      catalog_nbr: toStr(c.catalog_nbr),
      course: toStr(c.course),
      section: toInt(c.section),
      component: c.component || '',
      title: c.title || '',
      instructor: c.instructor || '',
      days: c.days || '',
      sun: !!c.sun, mon: !!c.mon, tue: !!c.tue, wed: !!c.wed, thu: !!c.thu, fri: !!c.fri, sat: !!c.sat,
      start_time: c.start_time || '', end_time: c.end_time || '',
      time_tba: !!c.time_tba,
      room: c.room || '',
      units: c.units != null ? Number(c.units) : null,
      has_sections: !!c.has_sections,
      section_count: c.section_count != null ? Number(c.section_count) : 0,
      extra_meetings: extra
    };
  }

  function normalizeSection(s){
    return {
      term_code: toInt(s.term_code),
      parent_class_nbr: toInt(s.parent_class_nbr),
      section_nbr: toInt(s.section_nbr),
      section_code: s.section_code || '',
      component: s.component || '',
      course: toStr(s.course),
      title: s.title || '',
      days: s.days || '',
      sun: !!s.sun, mon: !!s.mon, tue: !!s.tue, wed: !!s.wed, thu: !!s.thu, fri: !!s.fri, sat: !!s.sat,
      start_time: s.start_time || '', end_time: s.end_time || '',
      time_tba: !!s.time_tba,
      room: s.room || '',
      instructor: s.instructor || ''
    };
  }

  /* ---------------- persistence ---------------- */

  function defaultState(){
    var current = data.terms.filter(function(t){ return t.is_current; })[0] || data.terms[0] || { term_code: null };
    var term = current.term_code;
    return {
      selectedTerm: term,
      bank: [],
      plans: [{ id: makeId(), name: 'PLAN A', term: term, picks: {} }],
      currentPlanIndex: 0
    };
  }

  function loadPersisted(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.plans) || parsed.plans.length === 0) return defaultState();
      if(!data.terms.some(function(t){ return t.term_code === parsed.selectedTerm; })){
        var current = data.terms.filter(function(t){ return t.is_current; })[0] || data.terms[0];
        parsed.selectedTerm = current ? current.term_code : parsed.selectedTerm;
      }
      if(typeof parsed.currentPlanIndex !== 'number' || parsed.currentPlanIndex < 0 || parsed.currentPlanIndex >= parsed.plans.length){
        parsed.currentPlanIndex = 0;
      }
      parsed.bank = Array.isArray(parsed.bank) ? parsed.bank : [];
      parsed.plans.forEach(function(p){ if(!p.picks || typeof p.picks !== 'object') p.picks = {}; });
      return parsed;
    }catch(e){ return defaultState(); }
  }

  function save(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); }catch(e){}
  }

  function makeId(){ return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function currentPlan(){ return appState.plans[appState.currentPlanIndex]; }

  /* ---------------- rendering: top-level ---------------- */

  function renderAll(){
    renderTermSelect();
    renderPlanArea();
    renderClassBank();
    if(ui.drawerOpen){ renderSubjectSelect(); renderDrawerList(); }
  }

  function renderTermSelect(){
    var sel = el('term-select');
    var sortedTerms = data.terms.slice().sort(function(a,b){ return (b.term_code||0) - (a.term_code||0); });
    sel.innerHTML = sortedTerms.map(function(t){
      return '<option value="' + t.term_code + '">' + escapeHtml(t.term_name) + '</option>';
    }).join('');
    sel.value = String(appState.selectedTerm);
  }

  /* ---------------- rendering: plan area ---------------- */

  function nextLetter(){
    var used = {};
    appState.plans.forEach(function(p){
      var m = /^PLAN ([A-Z])$/.exec(p.name || '');
      if(m) used[m[1]] = true;
    });
    for(var i=0;i<26;i++){
      var L = String.fromCharCode(65+i);
      if(!used[L]) return L;
    }
    return String(appState.plans.length + 1);
  }

  function navigatePlan(delta){
    var n = appState.plans.length;
    appState.currentPlanIndex = (appState.currentPlanIndex + delta + n) % n;
    save();
    renderPlanArea();
    renderClassBank();
  }

  function addPlan(){
    var letter = nextLetter();
    appState.plans.push({ id: makeId(), name: 'PLAN ' + letter, term: appState.selectedTerm, picks: {} });
    appState.currentPlanIndex = appState.plans.length - 1;
    save(); renderPlanArea(); renderClassBank();
  }

  function duplicatePlan(){
    var plan = currentPlan();
    var copy = { id: makeId(), name: plan.name + ' COPY', term: plan.term, picks: Object.assign({}, plan.picks) };
    var idx = appState.currentPlanIndex + 1;
    appState.plans.splice(idx, 0, copy);
    appState.currentPlanIndex = idx;
    save(); renderPlanArea(); renderClassBank();
  }

  function deleteOrClearPlan(){
    if(appState.plans.length === 1){
      appState.plans[0].picks = {};
    } else {
      appState.plans.splice(appState.currentPlanIndex, 1);
      if(appState.currentPlanIndex >= appState.plans.length) appState.currentPlanIndex = appState.plans.length - 1;
    }
    save(); renderPlanArea(); renderClassBank();
  }

  function renderPlanArea(){
    var plan = currentPlan();
    if(!plan) return;

    var nameEl = el('plan-name');
    if(document.activeElement !== nameEl) nameEl.textContent = plan.name;

    var keys = Object.keys(plan.picks);
    var count = keys.length;
    var units = 0;
    keys.forEach(function(k){
      var lec = data.classesByNbr.get(Number(k));
      if(lec && typeof lec.units === 'number') units += lec.units;
    });
    var summaryEl = el('plan-summary');
    if(count === 0){
      summaryEl.textContent = 'EMPTY';
    } else {
      summaryEl.textContent = count + ' CLASS' + (count !== 1 ? 'ES' : '') + ' · ' + roundUnits(units) + ' UNIT' + (units !== 1 ? 'S' : '');
    }

    renderCalendar(plan);

    el('plan-counter').textContent = (appState.currentPlanIndex + 1) + ' / ' + appState.plans.length;
    var letterMatch = /^PLAN ([A-Z])$/.exec(plan.name || '');
    el('plan-add').textContent = '+ MAKE A PLAN ' + nextLetter();
    el('plan-delete').textContent = appState.plans.length === 1 ? 'CLEAR PLAN' : ('DELETE ' + plan.name);
  }

  function roundUnits(n){
    var r = Math.round(n * 10) / 10;
    return r;
  }

  /* ---------------- calendar ---------------- */

  function renderGutter(){
    var gutter = el('calendar-gutter');
    gutter.innerHTML = '';
    for(var h = HOUR_START; h <= HOUR_END; h++){
      var label = document.createElement('div');
      label.className = 'gutter-label';
      label.style.top = ((h - HOUR_START) * PX_PER_HOUR) + 'px';
      label.textContent = gutterLabel(h);
      gutter.appendChild(label);
    }
  }

  function gutterLabel(h){
    var period = h < 12 ? 'A' : 'P';
    var hh = h % 12;
    if(hh === 0) hh = 12;
    return hh + period;
  }

  function timeToMinutes(str){
    if(!str) return null;
    var m = /^(\d{1,2}):(\d{2})/.exec(str);
    if(!m) return null;
    return parseInt(m[1],10) * 60 + parseInt(m[2],10);
  }

  function formatTime(min){
    var h = Math.floor(min/60), m = min%60;
    var ap = h >= 12 ? 'p' : 'a';
    var hh = h % 12; if(hh === 0) hh = 12;
    return hh + ':' + String(m).padStart(2,'0') + ap;
  }
  function formatTimeRange(s,e){ return formatTime(s) + '–' + formatTime(e); }

  function parseDaysToFlags(str){
    var flags = {sun:false,mon:false,tue:false,wed:false,thu:false,fri:false,sat:false};
    var s = str || '';
    var i = 0;
    while(i < s.length){
      if(s.substr(i,2) === 'Su'){ flags.sun = true; i += 2; }
      else if(s.substr(i,2) === 'Sa'){ flags.sat = true; i += 2; }
      else if(s.substr(i,2) === 'Th'){ flags.thu = true; i += 2; }
      else if(s.substr(i,2) === 'Tu'){ flags.tue = true; i += 2; }
      else if(s[i] === 'M'){ flags.mon = true; i += 1; }
      else if(s[i] === 'T'){ flags.tue = true; i += 1; }
      else if(s[i] === 'W'){ flags.wed = true; i += 1; }
      else if(s[i] === 'F'){ flags.fri = true; i += 1; }
      else { i += 1; }
    }
    return flags;
  }

  function daysStringFromFlags(row){
    var out = '';
    if(row.sun) out += 'Su';
    if(row.mon) out += 'M';
    if(row.tue) out += 'Tu';
    if(row.wed) out += 'W';
    if(row.thu) out += 'Th';
    if(row.fri) out += 'F';
    if(row.sat) out += 'Sa';
    return out;
  }

  function formatComponentLabel(component, section){
    var comp = (component || 'LEC').toUpperCase();
    var num = (section != null) ? String(section).padStart(2,'0') : '';
    return (comp + ' ' + num).trim();
  }

  function formatDaysTimeLabel(row){
    var s = timeToMinutes(row.start_time), e = timeToMinutes(row.end_time);
    if(s == null || e == null) return 'Time TBA';
    return daysStringFromFlags(row) + ' ' + formatTimeRange(s,e);
  }

  function overlap(s1,e1,s2,e2){ return s1 < e2 && s2 < e1; }

  function addMeetingBlocks(blocks, row, color, extra){
    var s = timeToMinutes(row.start_time), e = timeToMinutes(row.end_time);
    if(s == null || e == null) return;
    DAYS.forEach(function(day){
      if(row[day]){
        var block = Object.assign({ day: day, start: s, end: e, color: color, course: row.course, room: row.room, instructor: row.instructor }, extra);
        blocks.push(block);
      }
    });
  }

  function addExtraMeetingBlocks(blocks, em, lecture, color){
    var s = timeToMinutes(em.start_time), e = timeToMinutes(em.end_time);
    if(s == null || e == null) return;
    var flags = parseDaysToFlags(em.days || '');
    DAYS.forEach(function(day){
      if(flags[day]){
        blocks.push({
          day: day, start: s, end: e, color: color, course: lecture.course,
          room: em.room || lecture.room, instructor: lecture.instructor,
          kind: 'lecture', classNbr: lecture.class_nbr,
          sectionLabel: formatComponentLabel(lecture.component, lecture.section), dashed: false
        });
      }
    });
  }

  function buildPlanBlocks(plan){
    var blocks = [];
    Object.keys(plan.picks).forEach(function(key){
      var classNbr = Number(key);
      var lecture = data.classesByNbr.get(classNbr);
      if(!lecture) return;
      var bankEntry = appState.bank.filter(function(b){ return b.course === lecture.course; })[0];
      var color = bankEntry ? bankEntry.color : '#171a12';

      addMeetingBlocks(blocks, lecture, color, {
        kind: 'lecture', classNbr: classNbr,
        sectionLabel: formatComponentLabel(lecture.component, lecture.section), dashed: false
      });

      (lecture.extra_meetings || []).forEach(function(em){
        addExtraMeetingBlocks(blocks, em, lecture, color);
      });

      var sectionNbr = plan.picks[key];
      if(sectionNbr){
        var section = data.sectionsByNbr.get(sectionNbr);
        if(section){
          addMeetingBlocks(blocks, section, lighten(color, 0.55), {
            kind: 'section', classNbr: classNbr, sectionLabel: section.section_code, dashed: true
          });
        }
      }
    });
    return blocks;
  }

  function markConflicts(blocks){
    DAYS.forEach(function(day){
      var dayBlocks = blocks.filter(function(b){ return b.day === day; });
      for(var i=0;i<dayBlocks.length;i++){
        for(var j=i+1;j<dayBlocks.length;j++){
          if(overlap(dayBlocks[i].start,dayBlocks[i].end,dayBlocks[j].start,dayBlocks[j].end)){
            dayBlocks[i].conflict = true; dayBlocks[j].conflict = true;
          }
        }
      }
    });
  }

  function clampPx(v){
    var max = (HOUR_END - HOUR_START) * PX_PER_HOUR;
    return Math.max(0, Math.min(v, max));
  }

  function renderCalendar(plan){
    var grid = el('calendar-grid');
    grid.innerHTML = '';
    var blocks = buildPlanBlocks(plan);
    markConflicts(blocks);

    DAYS.forEach(function(day){
      var col = document.createElement('div');
      col.className = 'calendar-col';
      col.dataset.day = day;
      for(var h = HOUR_START; h < HOUR_END; h++){
        var line = document.createElement('div');
        line.className = 'hour-line';
        line.style.top = ((h - HOUR_START) * PX_PER_HOUR) + 'px';
        col.appendChild(line);
      }
      blocks.filter(function(b){ return b.day === day; }).forEach(function(b){
        col.appendChild(renderBlockEl(b, plan));
      });
      grid.appendChild(col);
    });
  }

  function renderBlockEl(b, plan){
    var div = document.createElement('div');
    div.className = 'calendar-block' + (b.dashed ? ' calendar-block-section' : '') + (b.conflict ? ' calendar-block-conflict' : '');
    div.dataset.classNbr = b.classNbr;
    div.dataset.kind = b.kind;
    var top = clampPx((b.start - HOUR_START*60) / 60 * PX_PER_HOUR);
    var bottom = clampPx((b.end - HOUR_START*60) / 60 * PX_PER_HOUR);
    div.style.top = top + 'px';
    div.style.height = Math.max(18, bottom - top) + 'px';
    div.style.background = b.color;
    var textColor = luminance(b.color) > 0.55 ? '#11170d' : '#f4f1e6';
    div.style.color = textColor;

    var chipHtml = '';
    if(b.kind === 'lecture'){
      var lecture = data.classesByNbr.get(b.classNbr);
      var needsPick = lecture && lecture.has_sections && plan.picks[String(b.classNbr)] === null;
      if(needsPick){
        chipHtml = '<button type="button" class="block-chip" data-choose="' + b.classNbr + '">PICK A SECTION ▾</button>';
      }
    }

    div.innerHTML =
      '<button type="button" class="block-remove" data-remove="' + b.classNbr + '" aria-label="Remove ' + escapeAttr(b.course) + ' from plan">✕</button>' +
      '<div class="block-course">' + escapeHtml(b.course) + '</div>' +
      '<div class="block-section">' + escapeHtml(b.sectionLabel || '') + '</div>' +
      '<div class="block-time">' + formatTimeRange(b.start, b.end) + (b.room ? ' · ' + escapeHtml(b.room) : '') + '</div>' +
      chipHtml;

    return div;
  }

  /* ---------------- class bank ---------------- */

  function getCourseGroupCurrentTerm(courseKey){
    var map = data.courseMapByTerm.get(appState.selectedTerm);
    return map ? map.get(courseKey) : undefined;
  }

  function renderClassBank(){
    var list = el('bank-list');
    list.innerHTML = '';
    if(appState.bank.length === 0){
      list.appendChild(emptyState('Your bank is empty. Use ADD CLASS to start planning.'));
      return;
    }
    appState.bank.forEach(function(entry){
      var group = getCourseGroupCurrentTerm(entry.course);
      var wrapper = document.createElement('div');
      wrapper.className = 'bank-course';

      var head = document.createElement('div');
      head.className = 'bank-course-head';
      head.innerHTML =
        '<span class="swatch" style="background:' + entry.color + '"></span>' +
        '<span class="bank-course-info">' +
          '<span class="bank-course-key">' + escapeHtml(entry.course) + '</span>' +
          '<span class="bank-course-title">' + escapeHtml(group ? group.title : '') + '</span>' +
        '</span>' +
        '<button type="button" class="bank-remove" data-course="' + escapeAttr(entry.course) + '">REMOVE</button>';
      wrapper.appendChild(head);

      if(!group || group.lectures.length === 0){
        var note = document.createElement('p');
        note.className = 'bank-note';
        note.textContent = 'Not offered this quarter.';
        wrapper.appendChild(note);
      } else {
        var cardsWrap = document.createElement('div');
        cardsWrap.className = 'lecture-cards';
        group.lectures.slice().sort(function(a,b){ return (a.section||0) - (b.section||0); }).forEach(function(lec){
          cardsWrap.appendChild(renderLectureCard(lec, entry.color));
        });
        wrapper.appendChild(cardsWrap);
      }

      list.appendChild(wrapper);
    });
  }

  function renderLectureCard(lec, color){
    var div = document.createElement('div');
    var subs = data.sectionsByParent.get(lec.class_nbr) || [];
    var ownTime = !lec.time_tba && lec.start_time && lec.end_time;
    var subTimes = subs.some(function(s){ return !s.time_tba && s.start_time && s.end_time; });

    var timeLine, draggable;
    if(ownTime){ timeLine = formatDaysTimeLabel(lec); draggable = true; }
    else if(subs.length && subTimes){ timeLine = 'Drop it, then pick a time'; draggable = true; }
    else { timeLine = 'Time TBA'; draggable = false; }

    div.className = 'lecture-card' + (draggable ? '' : ' lecture-card-static');
    div.draggable = draggable;
    div.dataset.classNbr = lec.class_nbr;
    div.style.background = color;
    div.style.color = luminance(color) > 0.55 ? '#11170d' : '#f4f1e6';

    var count = appState.plans.reduce(function(n,p){
      return n + (Object.prototype.hasOwnProperty.call(p.picks, String(lec.class_nbr)) ? 1 : 0);
    }, 0);
    var onCurrent = Object.prototype.hasOwnProperty.call(currentPlan().picks, String(lec.class_nbr));

    var subLabel = '';
    if(subs.length){
      var isLab = subs[0].component === 'LBS';
      subLabel = ' · ' + subs.length + ' ' + (isLab ? 'lab' : 'discussion') + (subs.length > 1 ? 's' : '');
    }

    div.innerHTML =
      (count > 0 ? '<span class="card-badge' + (onCurrent ? ' card-badge-active' : '') + '">' + count + '</span>' : '') +
      '<div class="card-label">' + escapeHtml(formatComponentLabel(lec.component, lec.section)) + '</div>' +
      '<div class="card-time">' + escapeHtml(timeLine) + '</div>' +
      '<div class="card-meta">' + escapeHtml(lec.instructor || 'Staff') + subLabel + '</div>';

    return div;
  }

  function addCourseToBank(courseKey){
    if(appState.bank.some(function(b){ return b.course === courseKey; })) return;
    var usedColors = {};
    appState.bank.forEach(function(b){ usedColors[b.color] = true; });
    var color = PALETTE.filter(function(c){ return !usedColors[c]; })[0];
    if(!color) color = PALETTE[appState.bank.length % PALETTE.length];
    appState.bank.push({ course: courseKey, color: color });
    save();
    renderClassBank();
    renderDrawerList();
  }

  function removeCourseFromBank(courseKey){
    appState.bank = appState.bank.filter(function(b){ return b.course !== courseKey; });
    appState.plans.forEach(function(plan){
      Object.keys(plan.picks).forEach(function(k){
        var lec = data.classesByNbr.get(Number(k));
        if(lec && lec.course === courseKey) delete plan.picks[k];
      });
    });
    save();
    renderClassBank();
    renderPlanArea();
    if(ui.drawerOpen) renderDrawerList();
  }

  /* ---------------- drag / drop add ---------------- */

  function addLectureToCurrentPlan(classNbr){
    var lecture = data.classesByNbr.get(classNbr);
    if(!lecture) return;
    var ownTime = !lecture.time_tba && lecture.start_time && lecture.end_time;
    var subs = data.sectionsByParent.get(classNbr) || [];
    var subTimes = subs.some(function(s){ return !s.time_tba && s.start_time && s.end_time; });
    if(!ownTime && !subTimes) return;

    var plan = currentPlan();
    Object.keys(plan.picks).forEach(function(k){
      var existing = data.classesByNbr.get(Number(k));
      if(existing && existing.course === lecture.course && Number(k) !== classNbr) delete plan.picks[k];
    });
    plan.picks[classNbr] = null;
    save();
    renderPlanArea();
    renderClassBank();

    if(lecture.has_sections && subs.length > 0){
      requestAnimationFrame(function(){
        var anchor = document.querySelector('.calendar-block[data-class-nbr="' + classNbr + '"][data-kind="lecture"]');
        if(!anchor) anchor = document.querySelector('.calendar-block[data-class-nbr="' + classNbr + '"]');
        openChooser(classNbr, anchor);
      });
    }
  }

  /* ---------------- chooser popover ---------------- */

  function openChooser(classNbr, anchorEl){
    var lecture = data.classesByNbr.get(classNbr);
    if(!lecture) return;
    var subs = data.sectionsByParent.get(classNbr) || [];
    ui.chooser = { classNbr: classNbr };

    var plan = currentPlan();
    var occupied = buildPlanBlocks(plan).filter(function(b){ return b.classNbr !== classNbr; });

    var layer = el('popover-layer');
    layer.innerHTML = '<button type="button" class="popover-backdrop" aria-label="Close section picker"></button>';

    var pop = document.createElement('div');
    pop.className = 'popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Choose a section for ' + lecture.course);

    var rect = anchorEl ? anchorEl.getBoundingClientRect() : { top: 140, left: 140, bottom: 170 };
    var top = Math.min(window.innerHeight - 40, rect.bottom + 8);
    var left = Math.min(window.innerWidth - 316, Math.max(8, rect.left));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';

    var html = '<div class="popover-head">' + escapeHtml(lecture.course) + ' · choose a section</div><div class="popover-list">';
    subs.forEach(function(s){
      var conflict = sectionConflicts(s, occupied);
      html += '<button type="button" class="popover-option' + (conflict ? ' popover-option-conflict' : '') + '" data-section="' + s.section_nbr + '">' +
        '<span class="popover-option-code">' + escapeHtml(s.section_code) + '</span>' +
        '<span class="popover-option-time">' + formatSectionSchedule(s) + (conflict ? ' · <span class="conflict-tag">conflict</span>' : '') + '</span>' +
        '</button>';
    });
    html += '</div><button type="button" class="popover-later" data-later="1">DECIDE LATER</button>';
    pop.innerHTML = html;
    layer.appendChild(pop);
    layer.hidden = false;

    var firstBtn = pop.querySelector('button');
    if(firstBtn) firstBtn.focus();
  }

  function closeChooser(){
    ui.chooser = null;
    var layer = el('popover-layer');
    layer.innerHTML = '';
    layer.hidden = true;
  }

  function sectionConflicts(section, occupied){
    var s = timeToMinutes(section.start_time), e = timeToMinutes(section.end_time);
    if(s == null || e == null) return false;
    return DAYS.some(function(day){
      if(!section[day]) return false;
      return occupied.some(function(b){ return b.day === day && overlap(b.start,b.end,s,e); });
    });
  }

  function formatSectionSchedule(s){
    if(s.time_tba || !s.start_time) return 'Time TBA';
    var start = timeToMinutes(s.start_time), end = timeToMinutes(s.end_time);
    if(start == null || end == null) return 'Time TBA';
    return escapeHtml(daysStringFromFlags(s) + ' ' + formatTimeRange(start, end));
  }

  /* ---------------- drawer ---------------- */

  function openDrawer(){
    ui.drawerOpen = true;
    ui.drawerSubject = '';
    ui.drawerSearch = '';
    el('search-input').value = '';
    renderSubjectSelect();
    renderDrawerList();
    el('drawer-dim').hidden = false;
    el('drawer').hidden = false;
    el('drawer').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function(){
      el('drawer').classList.add('open');
      el('drawer-dim').classList.add('open');
    });
    setTimeout(function(){ el('search-input').focus(); }, 50);
  }

  function closeDrawer(){
    ui.drawerOpen = false;
    el('drawer').classList.remove('open');
    el('drawer-dim').classList.remove('open');
    el('drawer').setAttribute('aria-hidden', 'true');
    setTimeout(function(){
      if(!ui.drawerOpen){
        el('drawer').hidden = true;
        el('drawer-dim').hidden = true;
      }
    }, 220);
  }

  function renderSubjectSelect(){
    var subjects = Array.from(new Set(
      data.classes.filter(function(c){ return c.term_code === appState.selectedTerm; }).map(function(c){ return c.subject; })
    )).filter(Boolean).sort();
    var sel = el('subject-select');
    sel.innerHTML = '<option value="">All subjects</option>' + subjects.map(function(s){
      return '<option value="' + escapeAttr(s) + '">' + escapeHtml(s) + '</option>';
    }).join('');
    sel.value = ui.drawerSubject;
  }

  function renderDrawerList(){
    var listEl = el('drawer-list');
    listEl.innerHTML = '';
    var map = data.courseMapByTerm.get(appState.selectedTerm) || new Map();
    var courses = Array.from(map.values());
    if(ui.drawerSubject) courses = courses.filter(function(c){ return c.subject === ui.drawerSubject; });
    if(ui.drawerSearch){
      var q = ui.drawerSearch.toLowerCase();
      courses = courses.filter(function(c){
        return c.course.toLowerCase().indexOf(q) !== -1 || (c.title || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    courses.sort(function(a,b){ return a.course.localeCompare(b.course, undefined, {numeric:true}); });

    if(courses.length === 0){
      listEl.appendChild(emptyState('No courses match.'));
      return;
    }

    courses.forEach(function(c){
      var added = appState.bank.some(function(b){ return b.course === c.course; });
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'drawer-course' + (added ? ' drawer-course-added' : '');
      row.disabled = added;
      row.dataset.course = c.course;
      row.innerHTML =
        '<span class="drawer-course-info">' +
          '<span class="drawer-course-key">' + escapeHtml(c.course) + '</span>' +
          '<span class="drawer-course-title">' + escapeHtml(c.title) + '</span>' +
        '</span>' +
        '<span class="drawer-course-meta">' + (added ? 'ADDED ✓' : (c.lectures.length + ' LEC' + (c.lectures.length !== 1 ? 'S' : ''))) + '</span>';
      listEl.appendChild(row);
    });
  }

  /* ---------------- helpers ---------------- */

  function emptyState(text){
    var p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = text;
    return p;
  }

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function escapeAttr(str){ return escapeHtml(str); }

  function hexToRgb(hex){
    var h = hex.replace('#','');
    if(h.length === 3) h = h.split('').map(function(c){ return c+c; }).join('');
    var num = parseInt(h,16);
    return { r: (num>>16)&255, g: (num>>8)&255, b: num&255 };
  }
  function rgbToHex(r,g,b){
    return '#' + [r,g,b].map(function(v){ return Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0'); }).join('');
  }
  function luminance(hex){
    var c = hexToRgb(hex);
    var vals = [c.r,c.g,c.b].map(function(v){
      v /= 255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*vals[0] + 0.7152*vals[1] + 0.0722*vals[2];
  }
  function lighten(hex, amt){
    var c = hexToRgb(hex);
    return rgbToHex(c.r + (255-c.r)*amt, c.g + (255-c.g)*amt, c.b + (255-c.b)*amt);
  }

})();
