import {
  VNode,
  removeElement,
  appendToElement,
  prependToElement,
  Seg,
  BaseFgEventRendererProps,
  ComponentContext,
  sortEventSegs,
  subrenderer,
  renderVNodes
} from '@fullcalendar/core'
import CellEvents from './CellEvents'


/* Event-rendering methods for the Table class
----------------------------------------------------------------------------------------------------------------------*/

export interface TableEventsProps extends BaseFgEventRendererProps {
  rowEls: HTMLElement[]
  colCnt: number
  colGroupNode: VNode
  renderIntro: () => VNode[]
}

export default class TableEvents extends CellEvents<TableEventsProps> {

  protected attachSegs = subrenderer(attachSegs, detachSegs)

  rowStructs: any


  render(props: TableEventsProps, context: ComponentContext) {
    let segs = this.renderSegs({
      segs: props.segs,
      selectedInstanceId: props.selectedInstanceId,
      hiddenInstances: props.hiddenInstances,
      isDragging: props.isDragging,
      isResizing: props.isResizing,
      isSelecting: props.isSelecting
    }) // doesn't need interactingSeg

    this.rowStructs = this.attachSegs({
      segs,
      rowEls: props.rowEls,
      colCnt: props.colCnt,
      colGroupNode: props.colGroupNode,
      renderIntro: props.renderIntro,
      isDragging: props.isDragging,
      isResizing: props.isResizing,
      isSelecting: props.isSelecting,
      interactingSeg: props.interactingSeg
    })
  }


  // Computes a default `displayEventEnd` value if one is not expliclty defined
  computeDisplayEventEnd() {
    return this.props.colCnt === 1 // we'll likely have space if there's only one day
  }

}


// Renders the given foreground event segments onto the grid
function attachSegs({ segs, rowEls, colCnt, renderIntro }: TableEventsProps, context: ComponentContext) {

  let rowStructs = renderSegRows(segs, rowEls.length, colCnt, renderIntro, context)

  // append to each row's content skeleton
  rowEls.forEach(function(rowNode, i) {
    rowNode.querySelector('.fc-content-skeleton > table').appendChild(
      rowStructs[i].tbodyEl
    )
  })

  return rowStructs
}


// Unrenders all currently rendered foreground event segments
function detachSegs(rowStructs) {
  for (let rowStruct of rowStructs) {
    removeElement(rowStruct.tbodyEl)
  }
}


// Uses the given events array to generate <tbody> elements that should be appended to each row's content skeleton.
// Returns an array of rowStruct objects (see the bottom of `renderSegRow`).
// PRECONDITION: each segment shoud already have a rendered and assigned `.el`
export function renderSegRows(segs: Seg[], rowCnt: number, colCnt: number, renderIntro, context: ComponentContext) {
  let rowStructs = []
  let segRows
  let row

  segRows = groupSegRows(segs, rowCnt) // group into nested arrays

  // iterate each row of segment groupings
  for (row = 0; row < segRows.length; row++) {
    rowStructs.push(
      renderSegRow(row, segRows[row], colCnt, renderIntro, context)
    )
  }

  return rowStructs
}


// Given a row # and an array of segments all in the same row, render a <tbody> element, a skeleton that contains
// the segments. Returns object with a bunch of internal data about how the render was calculated.
// NOTE: modifies rowSegs
function renderSegRow(row, rowSegs, colCnt: number, renderIntro, context: ComponentContext) {
  let { isRtl } = context
  let segLevels = buildSegLevels(rowSegs, context) // group into sub-arrays of levels
  let levelCnt = Math.max(1, segLevels.length) // ensure at least one level
  let tbody = document.createElement('tbody')
  let segMatrix = [] // lookup for which segments are rendered into which level+col cells
  let cellMatrix = [] // lookup for all <td> elements of the level+col matrix
  let loneCellMatrix = [] // lookup for <td> elements that only take up a single column
  let i
  let levelSegs
  let col
  let tr: HTMLTableRowElement
  let j
  let seg
  let td: HTMLTableCellElement

  // populates empty cells from the current column (`col`) to `endCol`
  function emptyCellsUntil(endCol) {
    while (col < endCol) {
      // try to grab a cell from the level above and extend its rowspan. otherwise, create a fresh cell
      td = (loneCellMatrix[i - 1] || [])[col]
      if (td) {
        td.rowSpan = (td.rowSpan || 1) + 1
      } else {
        td = document.createElement('td')

        if (isRtl) {
          tr.insertBefore(td, tr.firstChild)
        } else {
          tr.appendChild(td)
        }
      }
      cellMatrix[i][col] = td
      loneCellMatrix[i][col] = td
      col++
    }
  }

  for (i = 0; i < levelCnt; i++) { // iterate through all levels
    levelSegs = segLevels[i]
    col = 0
    tr = document.createElement('tr')

    segMatrix.push([])
    cellMatrix.push([])
    loneCellMatrix.push([])

    // levelCnt might be 1 even though there are no actual levels. protect against this.
    // this single empty row is useful for styling.
    if (levelSegs) {
      for (j = 0; j < levelSegs.length; j++) { // iterate through segments in level
        seg = levelSegs[j]
        let { firstCol, lastCol } = seg

        emptyCellsUntil(firstCol)

        // create a container that occupies or more columns. append the event element.
        td = document.createElement('td')
        td.className = 'fc-event-container'
        td.appendChild(seg.el)
        if (firstCol !== lastCol) {
          td.colSpan = lastCol - firstCol + 1
        } else { // a single-column segment
          loneCellMatrix[i][col] = td
        }

        while (col <= lastCol) {
          cellMatrix[i][col] = td
          segMatrix[i][col] = seg
          col++
        }

        if (isRtl) {
          tr.insertBefore(td, tr.firstChild)
        } else {
          tr.appendChild(td)
        }
      }
    }

    emptyCellsUntil(colCnt) // finish off the row

    let introEls = renderVNodes(renderIntro(), context)

    if (isRtl) {
      appendToElement(tr, introEls)
    } else {
      prependToElement(tr, introEls)
    }

    tbody.appendChild(tr)
  }

  return { // a "rowStruct"
    row: row, // the row number
    tbodyEl: tbody,
    cellMatrix: cellMatrix,
    segMatrix: segMatrix,
    segLevels: segLevels,
    segs: rowSegs
  }
}


// Stacks a flat array of segments, which are all assumed to be in the same row, into subarrays of vertical levels.
// NOTE: modifies segs
function buildSegLevels(segs: Seg[], context: ComponentContext) {
  let levels = []
  let i
  let seg
  let j

  // Give preference to elements with certain criteria, so they have
  // a chance to be closer to the top.
  segs = sortEventSegs(segs, context.eventOrderSpecs)

  for (i = 0; i < segs.length; i++) {
    seg = segs[i]

    // loop through levels, starting with the topmost, until the segment doesn't collide with other segments
    for (j = 0; j < levels.length; j++) {
      if (!isDaySegCollision(seg, levels[j])) {
        break
      }
    }

    // `j` now holds the desired subrow index
    seg.level = j

    // create new level array if needed and append segment
    ;(levels[j] || (levels[j] = [])).push(seg)
  }

  // order segments left-to-right. very important if calendar is RTL
  for (j = 0; j < levels.length; j++) {
    levels[j].sort(compareDaySegCols)
  }

  return levels
}


// Given a flat array of segments, return an array of sub-arrays, grouped by each segment's row
function groupSegRows(segs: Seg[], rowCnt: number) {
  let segRows = []
  let i

  for (i = 0; i < rowCnt; i++) {
    segRows.push([])
  }

  for (i = 0; i < segs.length; i++) {
    segRows[segs[i].row].push(segs[i])
  }

  return segRows
}


// Computes whether two segments' columns collide. They are assumed to be in the same row.
function isDaySegCollision(seg: Seg, otherSegs: Seg) {
  let i
  let otherSeg

  for (i = 0; i < otherSegs.length; i++) {
    otherSeg = otherSegs[i]

    if (
      otherSeg.firstCol <= seg.lastCol &&
      otherSeg.lastCol >= seg.firstCol
    ) {
      return true
    }
  }

  return false
}


// A cmp function for determining the first event
function compareDaySegCols(a: Seg, b: Seg) {
  return a.firstCol - b.lastCol
}