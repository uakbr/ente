import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photos/ente_theme_data.dart';
import 'package:photos/services/local_sync_service.dart';
import 'package:photos/ui/backup_folder_selection_page.dart';
import 'package:photos/utils/navigation_util.dart';

class GalleryFooterWidget extends StatelessWidget {
  const GalleryFooterWidget({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(padding: EdgeInsets.all(6)),
        Divider(
          height: 1,
        ),
        Container(
          padding: EdgeInsets.fromLTRB(20, 24, 20, 72),
          child: ElevatedButton(
            style: Theme.of(context).colorScheme.primaryActionButtonStyle,
            onPressed: () async {
              if (LocalSyncService.instance.hasGrantedLimitedPermissions()) {
                await PhotoManager.presentLimited();
              } else {
                routeToPage(
                  context,
                  BackupFolderSelectionPage(
                    buttonText: "preserve",
                  ),
                );
              }
            },
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.center,
              //mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.cloud_upload,
                  color: Theme.of(context).backgroundColor,
                ),
                Padding(padding: EdgeInsets.all(6)),
                Text(
                  "Preserve more",
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
