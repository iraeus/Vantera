VANTERA TMS - WINDOWS APP (.exe)
================================
You need: Windows 10 or 11, Node.js (the one you already installed), and internet.

1. Open desktop\config.json in Notepad and replace https://YOUR-SITE.netlify.app with your real website address.
   (If you skip this, the app asks for the address the first time it starts.)
2. In the black window, go into this folder:
      cd C:\Users\<you>\Downloads\lovable-project-c58aab8c\desktop
3. Install the tools (takes a few minutes, needs internet):
      npm install
4. Test it (a window should open with your website):
      npm start
5. Build the installer:
      npm run dist
   The installer appears here:   desktop\dist\Vantera-Setup.exe
6. Upload Vantera-Setup.exe somewhere your staff can download it, then paste the link
   in Vantera > Settings > App downloads (see the main README).

Notes
 - The app is just a window for your website, so when you update the website the app updates too.
 - Unsigned installers show "Windows protected your PC". Click More info > Run anyway.
   A code-signing certificate removes that warning (optional, paid).
 - Do not copy the node_modules or dist folders to other computers; share only Vantera-Setup.exe.
