using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text.Json;
using ModEditor.SpineViewer;
class ExportDraftAssets {
 static void Main(string[] args){
  string folder=args[0],output=args[1];Directory.CreateDirectory(output);Directory.CreateDirectory(Path.Combine(output,"parts"));
  var engine=Environment.GetEnvironmentVariable("MODSTUDIO_SPINE_ENGINE_PATH");
  if(string.IsNullOrWhiteSpace(engine))throw new InvalidOperationException("Set MODSTUDIO_SPINE_ENGINE_PATH to the SpineViewer Engine directory.");
  var setup=Scene.Load(folder,"","","",engine).GetAwaiter().GetResult();
  var textures=new Dictionary<string,TextureData>();
  var pages=new List<object>();var parts=new List<object>();var animations=new List<object>();
  try {
   foreach(var page in setup.regions.Select(r=>r.page).Distinct()){
    var texture=new TextureData(Path.Combine(folder,page));textures[page]=texture;File.Copy(Path.Combine(folder,page),Path.Combine(output,page),true);
    pages.Add(new{name=page,width=texture.Width,height=texture.Height,src="assets/sample/"+page});
   }
   for(int i=0;i<setup.regions.Length;i++){
    var r=setup.regions[i];using var crop=textures[r.page].Bitmap.Clone(new Rectangle(r.x,r.y,r.width,r.height),PixelFormat.Format32bppArgb);
    if(r.rotation==90)crop.RotateFlip(RotateFlipType.Rotate90FlipNone);else if(r.rotation==180)crop.RotateFlip(RotateFlipType.Rotate180FlipNone);else if(r.rotation==270)crop.RotateFlip(RotateFlipType.Rotate270FlipNone);
    using var thumb=new Bitmap(160,120);using(var g=Graphics.FromImage(thumb)){float scale=Math.Min(148f/crop.Width,108f/crop.Height);g.DrawImage(crop,(160-crop.Width*scale)/2,(120-crop.Height*scale)/2,crop.Width*scale,crop.Height*scale);}
    string image="part-"+i.ToString("D3")+".png";thumb.Save(Path.Combine(output,"parts",image),ImageFormat.Png);
    parts.Add(new{id=i,name=r.name,page=r.page,x=r.x,y=r.y,width=r.width,height=r.height,rotation=r.rotation,thumb="assets/sample/parts/"+image});
   }
   foreach(var name in new[]{"loop","loop_2"}){
    var scene=Scene.Load(folder,name,"default","",engine).GetAwaiter().GetResult();var draws=scene.frames[0];
    var xs=draws.SelectMany(d=>d.vertices.Where((_,i)=>i%2==0)).ToArray();var ys=draws.SelectMany(d=>d.vertices.Where((_,i)=>i%2==1)).ToArray();
    float minX=xs.Min(),minY=ys.Min(),bw=xs.Max()-minX,bh=ys.Max()-minY;float scale=Math.Min(720/Math.Max(1f,bw),720/Math.Max(1f,bh))*.88f;
    PointF Map(float x,float y)=>new((x-minX-bw/2)*scale+360,360-(y-minY-bh/2)*scale);
    using var image=Renderer.Render(draws,textures,720,720,Map);image.Save(Path.Combine(output,name+".png"),ImageFormat.Png);
    var geometry=draws.Select(d=>new{region=d.region,page=d.page,vertices=Enumerable.Range(0,d.vertices.Length/2).SelectMany(i=>{var p=Map(d.vertices[i*2],d.vertices[i*2+1]);return new[]{p.X,p.Y};}).ToArray(),triangles=d.triangles}).ToArray();
    animations.Add(new{id=name,label=name=="loop"?"循环姿态 A":"循环姿态 B",duration=scene.animations.First(a=>a.name==name).duration,sampledFrames=scene.frames.Length,src="assets/sample/"+name+".png",geometry});
   }
   long bytes=Directory.GetFiles(folder).Sum(p=>new FileInfo(p).Length);
   var data=new{title="Blade小公主 · 技能战损",folderName=Path.GetFileName(folder),sourceBytes=bytes,sourceFileCount=Directory.GetFiles(folder).Length,spineVersion=setup.version,skins=setup.skins,pages,parts,animations};
   File.WriteAllText(Path.Combine(output,"sample-data.js"),"window.MODSTUDIO_SAMPLE = "+JsonSerializer.Serialize(data)+";\n");
   Console.WriteLine("Exported "+parts.Count+" real attachment thumbnails, "+pages.Count+" atlas pages and 2 static Spine poses.");
  }finally{foreach(var texture in textures.Values)texture.Dispose();}
 }
}
