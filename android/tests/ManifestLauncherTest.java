package com.routeragent.jev;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/** MA5-S1: parses AndroidManifest.xml as XML and resolves the one MAIN/LAUNCHER entry to the activity it opens. */
public final class ManifestLauncherTest {
    private static final String NS = "http://schemas.android.com/apk/res/android";

    static Document parse(byte[] xml) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        return f.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
    }

    private static String full(String pkg, String name) { return name.startsWith(".") ? pkg + name : name; }

    private static boolean launches(Element component) {
        NodeList filters = component.getElementsByTagName("intent-filter");
        for (int i = 0; i < filters.getLength(); i++) {
            Element filter = (Element) filters.item(i);
            boolean main = false, launcher = false;
            NodeList actions = filter.getElementsByTagName("action");
            for (int a = 0; a < actions.getLength(); a++) main |= "android.intent.action.MAIN".equals(((Element) actions.item(a)).getAttributeNS(NS, "name"));
            NodeList categories = filter.getElementsByTagName("category");
            for (int c = 0; c < categories.getLength(); c++) launcher |= "android.intent.category.LAUNCHER".equals(((Element) categories.item(c)).getAttributeNS(NS, "name"));
            if (main && launcher) return true;
        }
        return false;
    }

    /** The fully qualified activity class the launcher opens; throws unless exactly one exported launcher resolves to a declared activity. */
    static String launcherTarget(Document doc) {
        Element manifest = doc.getDocumentElement();
        String pkg = manifest.getAttribute("package");
        List<String> activities = new ArrayList<>();
        NodeList declared = manifest.getElementsByTagName("activity");
        for (int i = 0; i < declared.getLength(); i++) activities.add(full(pkg, ((Element) declared.item(i)).getAttributeNS(NS, "name")));
        List<String> targets = new ArrayList<>();
        for (String tag : new String[] { "activity", "activity-alias" }) {
            NodeList nodes = manifest.getElementsByTagName(tag);
            for (int i = 0; i < nodes.getLength(); i++) {
                Element e = (Element) nodes.item(i);
                if (!launches(e)) continue;
                if (!"true".equals(e.getAttributeNS(NS, "exported"))) throw new IllegalStateException("The launcher entry must be exported.");
                targets.add(full(pkg, tag.equals("activity") ? e.getAttributeNS(NS, "name") : e.getAttributeNS(NS, "targetActivity")));
            }
        }
        if (targets.size() != 1) throw new IllegalStateException("Expected exactly one launcher, found " + targets.size() + ".");
        if (!activities.contains(targets.get(0))) throw new IllegalStateException("Launcher target is not a declared activity: " + targets.get(0));
        return targets.get(0);
    }

    private static Document xml(String body) throws Exception {
        return parse(("<manifest xmlns:android=\"" + NS + "\" package=\"com.routeragent.jev\"><application>" + body + "</application></manifest>").getBytes(StandardCharsets.UTF_8));
    }

    private static final String FILTER = "<intent-filter><action android:name=\"android.intent.action.MAIN\"/><category android:name=\"android.intent.category.LAUNCHER\"/></intent-filter>";

    private static void refuses(String label, String body) throws Exception {
        try { String t = launcherTarget(xml(body)); if (!t.equals("com.routeragent.jev.NativeCompanionActivity")) return; }
        catch (IllegalStateException expected) { return; }
        throw new AssertionError("Accepted: " + label);
    }

    public static void main(String[] args) throws Exception {
        Document real = parse(java.nio.file.Files.readAllBytes(new File(args[0]).toPath()));
        Element manifest = real.getDocumentElement();
        if (!"com.routeragent.jev".equals(manifest.getAttribute("package"))) throw new AssertionError("Package identity changed.");
        String target = launcherTarget(real);
        if (!"com.routeragent.jev.NativeCompanionActivity".equals(target)) throw new AssertionError("Launcher opens " + target);
        Element app = (Element) manifest.getElementsByTagName("application").item(0);
        if (!"false".equals(app.getAttributeNS(NS, "usesCleartextTraffic")) || !"false".equals(app.getAttributeNS(NS, "allowBackup")))
            throw new AssertionError("Cleartext traffic and backup must stay off.");
        NodeList perms = manifest.getElementsByTagName("uses-permission");
        for (int i = 0; i < perms.getLength(); i++) {
            String p = ((Element) perms.item(i)).getAttributeNS(NS, "name");
            if (!"android.permission.INTERNET".equals(p)) throw new AssertionError("Unexpected permission: " + p);
        }

        // The MA4 shape (WebView MainActivity as launcher) and other wrong shapes are rejected.
        refuses("legacy WebView launcher", "<activity android:name=\".NativeCompanionActivity\" android:exported=\"false\"/><activity android:name=\".MainActivity\" android:exported=\"true\">" + FILTER + "</activity>");
        refuses("two launchers", "<activity android:name=\".NativeCompanionActivity\" android:exported=\"true\">" + FILTER + "</activity><activity-alias android:name=\".MainActivity\" android:targetActivity=\".NativeCompanionActivity\" android:exported=\"true\">" + FILTER + "</activity-alias>");
        refuses("alias to an undeclared activity", "<activity-alias android:name=\".MainActivity\" android:targetActivity=\".NativeCompanionActivity\" android:exported=\"true\">" + FILTER + "</activity-alias>");
        refuses("unexported launcher", "<activity android:name=\".NativeCompanionActivity\" android:exported=\"false\">" + FILTER + "</activity>");
        refuses("no launcher", "<activity android:name=\".NativeCompanionActivity\" android:exported=\"false\"/>");
        System.out.println("ManifestLauncherTest passed: launcher opens " + target);
    }
}
