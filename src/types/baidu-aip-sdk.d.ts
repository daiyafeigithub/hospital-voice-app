declare module 'baidu-aip-sdk' {
  class AipSpeech {
    constructor(appId: string, apiKey: string, secretKey: string);
    recognize(buffer: Buffer, format: string, rate: number, options?: any): Promise<any>;
  }
  
  interface SpeechModule {
    AipSpeech: typeof AipSpeech;
  }
  
  export const speech: SpeechModule;
  export default {
    speech: {
      AipSpeech
    }
  };
}
