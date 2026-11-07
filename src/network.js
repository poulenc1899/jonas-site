// Co-author network: people <-> publications, rendered with d3-force.
(function () {
  'use strict';

  var host = document.getElementById('network-chart');
  if (!host || !window.d3) return;

  fetch('network.json')
    .then(function (r) { return r.json(); })
    .then(draw)
    .catch(function () { host.textContent = 'The network diagram could not be loaded.'; });

  function draw(data) {
    var width = host.clientWidth || 720;
    var height = Math.max(420, Math.min(640, width * 0.75));
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var nodes = data.nodes.map(function (d) { return Object.assign({}, d); });
    var links = data.links.map(function (d) { return Object.assign({}, d); });

    var radius = function (d) {
      if (d.kind === 'me') return 14;
      if (d.kind === 'pub') return 9;
      return 4 + Math.min(d.papers - 1, 3) * 2.5;
    };

    var svg = d3.select(host).append('svg')
      .attr('viewBox', [-width / 2, -height / 2, width, height])
      .attr('width', '100%')
      .attr('height', height);

    var tooltip = d3.select(host).append('div').attr('class', 'net-tip').attr('hidden', true);

    // Jonas in the centre, publications pinned on a ring around them (newest at
    // the top, clockwise), co-authors free to settle around their paper(s).
    // People on several papers end up between those papers.
    var me = nodes.find(function (n) { return n.kind === 'me'; });
    if (me) { me.fx = 0; me.fy = 0; }
    var pubs = nodes.filter(function (n) { return n.kind === 'pub'; });
    var ring = Math.max(90, Math.min(width, height) / 2 - 110);
    pubs.forEach(function (p, i) {
      var a = -Math.PI / 2 + (i / pubs.length) * 2 * Math.PI;
      p.fx = ring * Math.cos(a) * (width > height ? 1.25 : 1);
      p.fy = ring * Math.sin(a);
    });
    nodes.forEach(function (n) {
      if (n.kind !== 'person') return;
      // Start each person next to their first paper so the layout settles quickly.
      var l = links.find(function (l) { return l.source === n.id; });
      var p = l && pubs.find(function (p) { return p.id === l.target; });
      if (p) { n.x = p.fx + (Math.random() - 0.5) * 40; n.y = p.fy + (Math.random() - 0.5) * 40; }
    });

    links.forEach(function (l) {
      var t = pubs.find(function (p) { return p.id === l.target; });
      if (t) t.degree = (t.degree || 0) + 1;
    });

    var sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(function (d) { return d.id; })
        .distance(function (l) { return l.source.kind === 'me' ? ring : 38 + Math.sqrt(l.target.degree || 1) * 6; })
        .strength(function (l) { return l.source.kind === 'me' ? 0.02 : 0.7; }))
      .force('charge', d3.forceManyBody().strength(-35).distanceMax(120))
      .force('collide', d3.forceCollide().radius(function (d) { return radius(d) + (d.kind === 'pub' ? 14 : 2.5); }));

    var link = svg.append('g').attr('class', 'net-links')
      .selectAll('line').data(links).join('line');

    var node = svg.append('g').selectAll('g').data(nodes).join('g')
      .attr('class', function (d) { return 'net-node ' + d.kind + (d.orcid ? ' has-orcid' : ''); })
      .attr('tabindex', function (d) { return d.orcid || d.href ? 0 : null; })
      .attr('role', function (d) { return d.orcid || d.href ? 'link' : null; })
      .attr('aria-label', function (d) { return d.kind === 'pub' ? d.title : d.label; });

    node.filter(function (d) { return d.kind === 'pub'; }).append('rect')
      .attr('x', -9).attr('y', -9).attr('width', 18).attr('height', 18).attr('rx', 4);
    node.filter(function (d) { return d.kind !== 'pub'; }).append('circle')
      .attr('r', radius);

    // Only Jonas and the papers are labelled; people show on hover/focus.
    var label = svg.append('g').attr('class', 'net-labels')
      .selectAll('text').data(nodes.filter(function (d) { return d.kind !== 'person'; })).join('text')
      .attr('class', function (d) { return 'net-label ' + d.kind; })
      .attr('dy', function (d) {
        if (d.kind === 'me') return radius(d) + 16;
        return d.fy > 0 ? radius(d) + 16 : -(radius(d) + 7);
      })
      .text(function (d) { return d.kind === 'pub' ? d.label + (d.year ? ' (' + d.year + ')' : '') : d.label; });

    function neighbours(d) {
      var set = new Set([d.id]);
      links.forEach(function (l) {
        if (l.source.id === d.id) set.add(l.target.id);
        if (l.target.id === d.id) set.add(l.source.id);
      });
      return set;
    }

    function focus(event, d) {
      var near = neighbours(d);
      node.classed('dim', function (n) { return !near.has(n.id); });
      label.classed('dim', function (n) { return !near.has(n.id); });
      link.classed('dim', function (l) { return l.source.id !== d.id && l.target.id !== d.id; });
      var lines = d.kind === 'pub'
        ? [d.title, d.year]
        : [d.label, d.institution, d.kind === 'person' ? d.papers + (d.papers > 1 ? ' shared publications' : ' shared publication') : null, d.orcid ? 'ORCID ' + d.orcid : 'No ORCID listed'];
      tooltip.attr('hidden', null).html('');
      lines.filter(Boolean).forEach(function (t, i) {
        tooltip.append(i ? 'span' : 'strong').text(t);
      });
      var box = host.getBoundingClientRect();
      var x = (event.clientX || box.left + width / 2 + d.x) - box.left;
      var y = (event.clientY || box.top + height / 2 + d.y) - box.top;
      tooltip.style('left', Math.min(x + 12, width - 220) + 'px').style('top', (y + 12) + 'px');
    }

    function blur() {
      node.classed('dim', false);
      label.classed('dim', false);
      link.classed('dim', false);
      tooltip.attr('hidden', true);
    }

    function open(d) {
      if (d.kind === 'pub' && d.href) window.location.href = d.href;
      else if (d.orcid) window.open('https://orcid.org/' + d.orcid, '_blank', 'noopener');
    }

    node
      .on('mouseenter', focus)
      .on('mousemove', focus)
      .on('mouseleave', blur)
      .on('focus', function (e, d) { focus(e, d); })
      .on('blur', blur)
      .on('click', function (e, d) { open(d); })
      .on('keydown', function (e, d) { if (e.key === 'Enter') open(d); });

    node.call(d3.drag()
      .on('start', function (e, d) { if (!e.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', function (e, d) { d.fx = e.x; d.fy = e.y; })
      .on('end', function (e, d) { if (!e.active) sim.alphaTarget(0); if (d.kind === 'person') { d.fx = null; d.fy = null; } }));

    function ticked() {
      var pad = 16;
      nodes.forEach(function (d) {
        d.x = Math.max(-width / 2 + pad, Math.min(width / 2 - pad, d.x));
        d.y = Math.max(-height / 2 + pad + 14, Math.min(height / 2 - pad, d.y));
      });
      link
        .attr('x1', function (d) { return d.source.x; }).attr('y1', function (d) { return d.source.y; })
        .attr('x2', function (d) { return d.target.x; }).attr('y2', function (d) { return d.target.y; });
      node.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });
      label.attr('x', function (d) { return d.x; }).attr('y', function (d) { return d.y; });
    }

    if (reduceMotion) {
      sim.stop();
      for (var i = 0; i < 300; i++) sim.tick();
      ticked();
    } else {
      sim.on('tick', ticked);
    }
  }
})();
