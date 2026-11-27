import { describe, expect, it } from 'vitest';
import { validateMetadata } from '../src/shared/instance-metadata';

describe('instance display categories',()=>{
  it('accepts PCL-style categories while preserving the custom text category',()=>{
    expect(validateMetadata({displayType:'mod',category:'常玩'})).toEqual({displayType:'mod',category:'常玩'});
  });
  it('rejects unknown display categories',()=>{
    expect(()=>validateMetadata({displayType:'scripts'})).toThrow('无效显示分类');
  });
});
