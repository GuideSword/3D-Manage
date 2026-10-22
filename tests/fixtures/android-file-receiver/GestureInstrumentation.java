package com.manage3d.filereceiver.qa;
import android.app.Instrumentation;
import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.graphics.Rect;
import android.view.MotionEvent;
import android.view.InputDevice;
import android.view.accessibility.AccessibilityNodeInfo;
// Shell-invoked QA gestures. Refuses all foreground packages except this ERP verification app.
public final class GestureInstrumentation extends Instrumentation {
  private String action;
  @Override public void onCreate(Bundle args) { super.onCreate(args); action=args==null?"":args.getString("action",""); start(); }
  private void event(long down,int type,float[] xs,float[] ys) {
    MotionEvent.PointerProperties[] properties=new MotionEvent.PointerProperties[xs.length];
    MotionEvent.PointerCoords[] coords=new MotionEvent.PointerCoords[xs.length];
    for(int i=0;i<xs.length;i++){properties[i]=new MotionEvent.PointerProperties();properties[i].id=i;properties[i].toolType=MotionEvent.TOOL_TYPE_FINGER;coords[i]=new MotionEvent.PointerCoords();coords[i].x=xs[i];coords[i].y=ys[i];coords[i].pressure=1;coords[i].size=1;}
    MotionEvent input=MotionEvent.obtain(down,SystemClock.uptimeMillis(),type,xs.length,properties,coords,0,0,1,1,0,0,InputDevice.SOURCE_TOUCHSCREEN,0);
    try { if(!getUiAutomation().injectInputEvent(input,true))throw new IllegalStateException("Gesture injection refused"); } finally {input.recycle();}
  }
  @Override public void onStart(){Bundle result=new Bundle();try{
    if(!action.equals("pinch")&&!action.equals("pan"))throw new IllegalArgumentException("Explicit pinch or pan required");
    getUiAutomation().waitForIdle(100,3000);
    AccessibilityNodeInfo root=getUiAutomation().getRootInActiveWindow();
    for(int attempt=0;root==null&&attempt<20;attempt++){SystemClock.sleep(100);root=getUiAutomation().getRootInActiveWindow();}
    if(root==null||!"com.anonymous.x3DManage.erp02d3afiles".contentEquals(root.getPackageName()))throw new IllegalStateException("ERP QA foreground required; no events sent");
    Rect bounds=new Rect();root.getBoundsInScreen(bounds);root.recycle();if(bounds.width()<300||bounds.height()<300)throw new IllegalStateException("QA viewport invalid");
    float cx=bounds.exactCenterX(),cy=bounds.exactCenterY(),w=bounds.width(),h=bounds.height();long down=SystemClock.uptimeMillis();
    if(action.equals("pinch")){
      float start=w*.10f,end=w*.30f;event(down,MotionEvent.ACTION_DOWN,new float[]{cx-start},new float[]{cy});
      event(down,MotionEvent.ACTION_POINTER_DOWN|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT),new float[]{cx-start,cx+start},new float[]{cy,cy});
      for(int i=1;i<=30;i++){float gap=start+(end-start)*i/30f;event(down,MotionEvent.ACTION_MOVE,new float[]{cx-gap,cx+gap},new float[]{cy,cy});SystemClock.sleep(16);}
      event(down,MotionEvent.ACTION_POINTER_UP|(1<<MotionEvent.ACTION_POINTER_INDEX_SHIFT),new float[]{cx-end,cx+end},new float[]{cy,cy});event(down,MotionEvent.ACTION_UP,new float[]{cx-end},new float[]{cy});
    }else{
      event(down,MotionEvent.ACTION_DOWN,new float[]{cx},new float[]{cy});for(int i=1;i<=30;i++){event(down,MotionEvent.ACTION_MOVE,new float[]{cx-w*.20f*i/30f},new float[]{cy-h*.08f*i/30f});SystemClock.sleep(16);}event(down,MotionEvent.ACTION_UP,new float[]{cx-w*.20f},new float[]{cy-h*.08f});
    }
    result.putString("result","passed");result.putString("action",action);finish(Activity.RESULT_OK,result);
  }catch(Exception error){result.putString("result","blocked");result.putString("reason",error.getMessage());finish(Activity.RESULT_CANCELED,result);}}
}
