export interface ReadingPosition {offset:number;displacement:number}

export class ReadingHistory {
  private back:ReadingPosition[]=[];
  private forward:ReadingPosition[]=[];
  get canBack(){return this.back.length>0;}
  get canForward(){return this.forward.length>0;}
  clear(){this.back=[];this.forward=[];}
  visit(from:ReadingPosition){this.back.push({...from});if(this.back.length>200)this.back.shift();this.forward=[];}
  move(direction:'back'|'forward',from:ReadingPosition):ReadingPosition|null{
    const source=direction==='back'?this.back:this.forward;
    const destination=direction==='back'?this.forward:this.back;
    const target=source.pop();if(!target)return null;
    destination.push({...from});return target;
  }
}
