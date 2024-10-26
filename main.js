/*
en...用了vue2，一开始的vue3 de半天bug就是没图，
查了查发现可能是vue3的mounted钩子不一定保证在所有子元素完全挂载到DOM后触发
*/
new Vue({ 
  el: '#app',
  data() {
    return {
      svgWidth: 1500,
      svgHeight: 600,
      padding: 80,
      chartWidth: 0,
      chartHeight: 0,
      baseline: 0,
      paths: [],
      years: [],
      data: [],
      stackedData: [],
      tooltipVisible: false,
      tooltipContent: '',
      colorScale: [
        '#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc',
        '#9e9ac8', '#807dba', '#6a51a3', '#4a1486'
      ],//动态调色不达预期，借助https://colorbrewer2.org/#type=sequential&scheme=Purples&n=8给的特定调色
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      viewBoxX: 0,
      viewBoxY: 0
    };
  },
  mounted() {
    this.chartWidth = this.svgWidth - 2 * this.padding;
    this.chartHeight = this.svgHeight - 2 * this.padding;
    this.baseline = this.svgHeight - this.padding;
    this.createStreamGraph();
    const svg = document.getElementById('streamGraph');
    svg.setAttribute('viewBox', `0 0 ${this.svgWidth} ${this.svgHeight}`);
    const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tooltip.setAttribute("x", "100"); 
    tooltip.setAttribute("y", "100"); 
    tooltip.setAttribute("font-size", "14");
    tooltip.setAttribute("fill", "black");
    tooltip.textContent = '';  
    tooltip.id = 'tooltipText';  //这里一开始没有额外设置，但是出现了显示不了tooltip的情况，于是为其再特化一个id，避免被覆盖或复用
    svg.appendChild(tooltip);
    svg.addEventListener('wheel', this.applyZoom);
    svg.addEventListener('mousedown', this.startDrag);
    svg.addEventListener('mousemove', this.drag);
    svg.addEventListener('mouseup', this.endDrag);
  },
  methods: {
    async loadCSVData(url) {
      const response = await fetch(url);
      const csvData = await response.text();
      return this.csvToArray(csvData);
    },//这里一开始不太会写...和gpt聊了之后又去看了fetch、async、await等操作，当时草草略过的后果...
    csvToArray(csv) {
      const [headerLine, ...rows] = csv.trim().split('\n');
      const headers = headerLine.split(',');
      return rows.map(row => {
        const values = row.split(',');
        const entry = {};
        headers.forEach((header, index) => {
          entry[header] = isNaN(values[index]) ? values[index] : +values[index];
        });
        return entry;
      });
    },
    async createStreamGraph() {
      this.data = await this.loadCSVData('data.csv');
      const svg = document.getElementById('streamGraph');
      this.years = this.data.map(d => d.year);
      const minYear = Math.min(...this.years);
      const maxYear = Math.max(...this.years);
      const names = Object.keys(this.data[0]).filter(key => key !== 'year');
      this.stackedData = names.map(name => this.data.map(d => d[name]));//累积，叠加画图
      const offsets = this.stackedData.reduce((acc, curr, i) => {
        if (i === 0) return [curr];
        return [...acc, curr.map((val, j) => val + acc[i - 1][j])];
      }, []);
      const maxOffset = Math.max(...offsets[offsets.length - 1]);
      this.draw(svg, this.chartWidth, this.chartHeight, this.padding, minYear, maxYear);
      names.forEach((name, i) => {
        const xCoords = this.years.map(year => this.padding + ((year - minYear) / (maxYear - minYear)) * this.chartWidth);
        const yLower = offsets[i].map(y => this.baseline - (y / maxOffset) * this.chartHeight);
        const yUpper = (i === 0 ? yLower : offsets[i - 1].map(y => this.baseline - (y / maxOffset) * this.chartHeight));
        const color = this.colorScale[i];
        const path = this.createLinearPath(xCoords, yLower, yUpper, color, name, i);
        svg.appendChild(path);
        this.paths.push({ path, name });
      });
    },
    draw(svg, chartWidth, chartHeight, padding, minYear, maxYear) {
      const xAxisYPos = this.svgHeight - padding;
      const yAxisXPos = padding;
      svg.innerHTML += `<line x1="${padding}" y1="${xAxisYPos}" x2="${this.svgWidth - padding}" y2="${xAxisYPos}" stroke="black"/>`;
      svg.innerHTML += `<line x1="${yAxisXPos}" y1="${padding}" x2="${yAxisXPos}" y2="${this.svgHeight - padding}" stroke="black"/>`;
      const yearStep = 10;
      for (let year = minYear; year <= maxYear; year += yearStep) {
        const xPos = padding + ((year - minYear) / (maxYear - minYear)) * chartWidth;
        svg.innerHTML += `<text x="${xPos}" y="${xAxisYPos + 20}" font-size="12" text-anchor="middle">${year}</text>`;
      }
      const maxYValue = 200000;
      const yStep = 50000;
      for (let yValue = 0; yValue <= maxYValue; yValue += yStep) {
        const yPos = this.svgHeight - padding - (yValue / maxYValue) * chartHeight;
        svg.innerHTML += `<text x="${yAxisXPos - 10}" y="${yPos + 5}" font-size="12" text-anchor="end">${yValue.toLocaleString()}</text>`;
        svg.innerHTML += `<line x1="${yAxisXPos}" y1="${yPos}" x2="${this.svgWidth - padding}" y2="${yPos}" stroke="#ccc" stroke-dasharray="2,2"/>`;
      }
    },
    //下面是更改过后的版本，闭合路径、重复边界点避免不同数据区域间出现毛刺
    createLinearPath(xCoords, yLower, yUpper, color, name, index) {
      let pathData = `M ${xCoords[0]},${yLower[0]}`;
      for (let i = 1; i < xCoords.length; i++) {
        pathData += ` L ${xCoords[i]},${yLower[i]}`;
      }
      for (let i = xCoords.length - 1; i >= 0; i--) {
        pathData += ` L ${xCoords[i]},${yUpper[i]}`;
      }
      pathData += " Z";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", color);
      path.setAttribute("stroke", "none");
      path.setAttribute("opacity", "0.8");
      path.addEventListener("mouseenter", (event) => {
        this.highlightPath(index); 
        this.updateTooltip(event, name, index); 
      });
      path.addEventListener("mousemove", (event) => {
        this.updateTooltip(event, name, index); 
      });
      path.addEventListener("mouseleave", () => {
        this.resetPaths(); 
        this.clearTooltip();
      });
      return path;
    },
    clearTooltip() {
      const tooltip = document.getElementById('tooltipText');
      tooltip.textContent = ''; 
    },    
    highlightPath(targetIndex) {
      this.paths.forEach((pa, index) => {
        if (index === targetIndex) {
          pa.path.setAttribute("opacity", "1"); 
        } else {
          pa.path.setAttribute("opacity", "0.2"); 
        }
      });
    },
    resetPaths() {
      this.paths.forEach((pa) => {
        pa.path.setAttribute("opacity", "0.8");
      });
    },
    updateTooltip(event, name, index) {
      const mouseX = event.offsetX;
      const yearIndex = Math.floor((mouseX - this.padding) / this.chartWidth * this.years.length);
      if (yearIndex >= 0 && yearIndex < this.years.length) {
        const year = this.years[yearIndex];
        const value = this.stackedData[index][yearIndex];
        const tooltip = document.getElementById('tooltipText');
        tooltip.textContent = `${name}: ${value.toLocaleString()} (${year})`;
      }
    },
    applyZoom(event) {
      const svg = document.getElementById('streamGraph');
      let viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;
      const newWidth = viewBox[2] * zoomFactor;
      const newHeight = viewBox[3] * zoomFactor;
      const mouseX = event.offsetX;
      const mouseY = event.offsetY;
      const svgRect = svg.getBoundingClientRect();
      const scaleX = (mouseX - svgRect.left) / svgRect.width;
      const scaleY = (mouseY - svgRect.top) / svgRect.height;
      viewBox[0] += (viewBox[2] - newWidth) * scaleX;
      viewBox[1] += (viewBox[3] - newHeight) * scaleY;
      viewBox[2] = newWidth;
      viewBox[3] = newHeight;
      svg.setAttribute('viewBox', viewBox.join(' '));
    },
    startDrag(event) {
      this.isDragging = true;
      const svg = document.getElementById('streamGraph');
      const viewBox = svg.getAttribute('viewBox').split(' ');
      this.viewBoxX = parseFloat(viewBox[0]);
      this.viewBoxY = parseFloat(viewBox[1]);
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
    },
    drag(event) {
      if (!this.isDragging) return;
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;
      const svg = document.getElementById('streamGraph');
      const viewBox = svg.getAttribute('viewBox').split(' ');
      const newViewBoxX = this.viewBoxX - deltaX;
      const newViewBoxY = this.viewBoxY - deltaY;
      svg.setAttribute('viewBox', `${newViewBoxX} ${newViewBoxY} ${viewBox[2]} ${viewBox[3]}`);
    },
    endDrag() {
      this.isDragging = false;
    }
  }
});
