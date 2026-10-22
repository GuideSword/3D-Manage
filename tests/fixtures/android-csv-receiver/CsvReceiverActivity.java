package com.manage3d.csvreceiver.qa;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.widget.TextView;
import android.widget.ScrollView;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import org.json.JSONObject;
// Local QA receiver: no network permission and no external transmission.
public final class CsvReceiverActivity extends Activity {
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    TextView view=new TextView(this); view.setTextSize(18); view.setPadding(24,24,24,24);
    ScrollView scroll=new ScrollView(this); scroll.addView(view); setContentView(scroll);
    try {
      if (!Intent.ACTION_SEND.equals(getIntent().getAction())) throw new IllegalArgumentException("SEND required");
      Uri uri=(Uri)getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
      if (uri==null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("Content URI required");
      ByteArrayOutputStream buffer=new ByteArrayOutputStream();
      try (InputStream input=getContentResolver().openInputStream(uri)) {
        if (input==null) throw new IllegalArgumentException("Cannot open CSV");
        byte[] chunk=new byte[8192]; int size;
        while ((size=input.read(chunk))!=-1) {
          if (buffer.size()+size>16*1024*1024) throw new IllegalArgumentException("QA file exceeds 16 MiB");
          buffer.write(chunk,0,size);
        }
      }
      byte[] bytes=buffer.toByteArray();
      try (FileOutputStream output=openFileOutput("received.csv",MODE_PRIVATE)) { output.write(bytes); }
      StringBuilder sha=new StringBuilder();
      for (byte b:MessageDigest.getInstance("SHA-256").digest(bytes)) sha.append(String.format("%02x",b&255));
      JSONObject proof=new JSONObject(); proof.put("result","passed"); proof.put("bytes",bytes.length); proof.put("sha256",sha.toString()); proof.put("mimeType",getIntent().getType()); proof.put("uri",uri.toString());
      try (FileOutputStream output=openFileOutput("proof.json",MODE_PRIVATE)) { output.write(proof.toString().getBytes("UTF-8")); }
      view.setText("CSV已在本地接收\n"+bytes.length+" bytes\nSHA-256: "+sha+"\n\n"+new String(bytes,"UTF-8"));
    } catch (Exception error) { view.setText("CSV本地验收失败："+error.getMessage()); }
  }
}
