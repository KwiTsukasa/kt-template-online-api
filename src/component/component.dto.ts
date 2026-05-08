import { DecodeDictKey } from '@/common';
import { Component } from './component.entity';
import { DictKeyEnum, DictKeyMap } from '@/utils/constant';
import { ApiProperty } from '@nestjs/swagger';

export class ComponentDto extends Component {
  [x: string]: any;
  @ApiProperty()
  @DecodeDictKey(DictKeyMap.get(DictKeyEnum.COMPONENT_TYPE))
  typeMsg: string;

  @ApiProperty()
  @DecodeDictKey([
    ...DictKeyMap.get(DictKeyEnum.CHART),
    ...DictKeyMap.get(DictKeyEnum.COMPONENT),
  ])
  componentTypeMsg: string;
  constructor(component: Component) {
    super(component);
    this._typeMsg = component.type;
    this._componentTypeMsg = component.componentType;
  }
}
