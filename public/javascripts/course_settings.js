/**
 * Copyright (C) 2011 Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
define([
  'i18n!course_settings',
  'jquery' /* $ */,
  'underscore',
  'jquery.ajaxJSON' /* ajaxJSON */,
  'jquery.instructure_date_and_time' /* datetimeString, date_field */,
  'jquery.instructure_forms' /* formSubmit, fillFormData, getFormData, formErrors */,
  'jqueryui/dialog',
  'compiled/jquery/fixDialogButtons' /* fix dialog formatting */,
  'jquery.instructure_misc_helpers' /* scrollSidebar */,
  'jquery.instructure_misc_plugins' /* confirmDelete, fragmentChange, showIf */,
  'jquery.keycodes' /* keycodes */,
  'jquery.loadingImg' /* loadingImage */,
  'compiled/jquery.rails_flash_notifications',
  'jquery.templateData' /* fillTemplateData, getTemplateData */,
  'link_enrollment' /* link_enrollment */,
  'vendor/jquery.ba-tinypubsub' /* /\.publish/ */,
  'vendor/jquery.scrollTo' /* /\.scrollTo/ */,
  'jqueryui/autocomplete' /* /\.autocomplete/ */,
  'jqueryui/sortable' /* /\.sortable/ */,
  'jqueryui/tabs' /* /\.tabs/ */
], function(I18n, $, _) {

  var GradePublishing = {
    status: null,
    checkup: function() {
      $.ajaxJSON($("#publish_to_sis_form").attr('action'), 'GET', {}, function(data) {
        if (!data.hasOwnProperty("sis_publish_overall_status")) return;
        GradePublishing.status = data.sis_publish_overall_status;
        GradePublishing.update(data.hasOwnProperty("sis_publish_statuses") ? data.sis_publish_statuses : {});
      });
    },
    update: function(messages, requestInProgress) {
      var $publish_grades_link = $("#publish_grades_link"),
          $publish_grades_error = $("#publish_grades_error");
      if (GradePublishing.status == 'published') {
        $publish_grades_error.hide();
        $publish_grades_link.html(I18n.t('links.republish', "Republish grades to SIS"));
        $publish_grades_link.removeClass("disabled");
      } else if (GradePublishing.status == 'publishing' || GradePublishing.status == 'pending') {
        $publish_grades_error.hide();
        $publish_grades_link.html(I18n.t('links.publishing', "Publishing grades to SIS..."));
        if (!requestInProgress) {
          setTimeout(GradePublishing.checkup, 5000);
        }
        $publish_grades_link.addClass("disabled");
      } else if (GradePublishing.status == 'unpublished') {
        $publish_grades_error.hide();
        $publish_grades_link.html(I18n.t('links.publish', "Publish grades to SIS"));
        $publish_grades_link.removeClass("disabled");
      } else {
        $publish_grades_error.show();
        $publish_grades_link.html(I18n.t('links.republish', "Republish grades to SIS"));
        $publish_grades_link.removeClass("disabled");
      }
      $messages = $("#publish_grades_messages");
      $messages.empty();
      $.each(messages, function(message, users) {
        var $message = $("<span/>");
        $message.text(message);
        var $item = $("<li/>");
        $item.append($message);
        $item.append(" - <b>" + users.length + "</b>");
        $messages.append($item);
      });
    },
    publish: function() {
      if (GradePublishing.status == 'publishing' || GradePublishing.status == 'pending' || GradePublishing.status == null) {
        return;
      }
      if (GradePublishing.status == 'published') {
        if (!confirm(I18n.t('confirm.re_publish_grades', "Are you sure you want to republish these grades to the student information system?")))
          return;
      } else {
        if (!confirm(I18n.t('confirm.publish_grades', "Are you sure you want to publish these grades to the student information system? You should only do this if all your grades have been finalized.")))
          return;
      }
      var $publish_to_sis_form = $("#publish_to_sis_form");
      GradePublishing.status = "publishing";
      GradePublishing.update({}, true);
      var successful_statuses = { "published": 1, "publishing": 1, "pending": 1 };
      var error = function(data, xhr, status, error) {
        GradePublishing.status = "unknown";
        $.flashError(I18n.t('errors.publish_grades', "Something went wrong when trying to publish grades to the student information system. Please try again later."));
        GradePublishing.update({});
      };
      $.ajaxJSON($publish_to_sis_form.attr('action'), 'POST', $publish_to_sis_form.getFormData(), function(data) {
        if (!data.hasOwnProperty("sis_publish_overall_status") || !successful_statuses.hasOwnProperty(data["sis_publish_overall_status"])) {
          error(null, null, I18n.t('errors.invalid_sis_status', "Invalid SIS publish status"), null);
          return;
        }
        GradePublishing.status = data.sis_publish_overall_status;
        GradePublishing.update(data.hasOwnProperty("sis_publish_statuses") ? data.sis_publish_statuses : {});
      }, error);
    }
  }

  $(document).ready(function() {
    var $add_section_form = $("#add_section_form"),
        $upload_image_form   = $("#upload_image_form"),
        $upload_back_ground_image_form = $("#upload_background_image_form"),
        $edit_section_form = $("#edit_section_form"),
        $course_form = $("#course_form"),
        $enrollment_dialog = $("#enrollment_dialog"),
        $tabBar = $("#course_details_tabs"),
        // as of jqueryui 1.9, the cookie trumps the fragment :(. so we hack
        // around that here
        initialTab = _.indexOf(_.pluck($tabBar.find('> ul a'), 'hash'), location.hash);

    $tabBar.tabs({cookie: {}, active: initialTab >= 0 ? initialTab : null}).show();

    $add_section_form.formSubmit({
      required: ['course_section[name]'],
      beforeSubmit: function(data) {
        $add_section_form.find("button").attr('disabled', true).text(I18n.t('buttons.adding_section', "Adding Section..."));
      },
      success: function(data) {
        var section = data.course_section,
            $section = $(".section_blank:first").clone(true).attr('class', 'section'),
            $option = $("<option/>");

        $add_section_form.find("button").attr('disabled', false).text(I18n.t('buttons.add_section', "Add Section"));
        $section.fillTemplateData({
          data: section,
          hrefValues: ['id']
        });
        $("#course_section_id_holder").show();
        $option.val(section.id).text(section.name).addClass('option_for_section_' + section.id);
        $("#sections .section_blank").before($section);
        $section.slideDown();
        $("#course_section_name").val();
      },
      error: function(data) {
        $add_section_form
          .formErrors(data)
          .find("button").attr('disabled', false).text(I18n.t('errors.section', "Add Section Failed, Please Try Again"));
      }
    });
    $(".cant_delete_section_link").click(function(event) {
      alert($(this).attr('title'));
      return false;
    });
    $edit_section_form.formSubmit({
      beforeSubmit: function(data) {
        $edit_section_form.hide();
        var $section = $edit_section_form.parents(".section");
        $section.find(".name").text(data['course_section[name]']).show();
        $section.loadingImage({image_size: "small"});
        return $section;
      },
      success: function(data, $section) {
        var section = data.course_section;
        $section.loadingImage('remove');
        $(".option_for_section_" + section.id).text(section.name);
      },
      error: function(data, $section) {
        $section.loadingImage('remove').find(".edit_section_link").click();
        $edit_section_form.formErrors(data);
      }
    })
    .find(":text")
      .bind('blur', function() {
        $edit_section_form.submit();
      })
      .keycodes('return esc', function(event) {
        if(event.keyString == 'return') {
          $edit_section_form.submit();
        } else {
          $(this).parents(".section").find(".name").show();
          $("body").append($edit_section_form.hide());
        }
      });
    $(".edit_section_link").click(function() {
      var $this = $(this),
          $section = $this.parents(".section"),
          data = $section.getTemplateData({textValues: ['name']});
      $edit_section_form.fillFormData(data, {object_name: "course_section"});
      $section.find(".name").hide().after($edit_section_form.show());
      $edit_section_form.attr('action', $this.attr('href'));
      $edit_section_form.find(":text:first").focus().select();
      return false;
    });
    $(".delete_section_link").click(function() {
      $(this).parents(".section").confirmDelete({
        url: $(this).attr('href'),
        message: I18n.t('confirm.delete_section', "Are you sure you want to delete this section?"),
        success: function(data) {
          $(this).slideUp(function() {
            $(this).remove();
          });
        }
      });
      return false;
    });
    $("#nav_form").submit(function(){
      tab_id_regex = /(\d+)$/;
      function tab_id_from_el(el) {
        var tab_id_str = $(el).attr("id");
        if (tab_id_str) {
          var tab_id = tab_id_str.replace(/^nav_edit_tab_id_/, '');
          if (tab_id.length > 0) {
            if(!tab_id.match(/context/)) {
              tab_id = parseInt(tab_id, 10);
            }
            return tab_id;
          }
        }
        return null;
      }

      var tabs = [];
      $("#nav_enabled_list li").each(function() {
        var tab_id = tab_id_from_el(this);
        if (tab_id !== null) { tabs.push({ id: tab_id }); }
      });
      $("#nav_disabled_list li").each(function() {
        var tab_id = tab_id_from_el(this);
        if (tab_id !== null) { tabs.push({ id: tab_id, hidden: true }); }
      });

      $("#tabs_json").val(JSON.stringify(tabs));
      return true;
    });

    $(".edit_nav_link").click(function(event) {
      event.preventDefault();
      $("#nav_form").dialog({
        modal: true,
        resizable: false,
        width: 400
      });
    });

    $("#nav_enabled_list, #nav_disabled_list").sortable({
      items: 'li.enabled',
      connectWith: '.connectedSortable',
      axis: 'y'
    }).disableSelection();

    $(document).fragmentChange(function(event, hash) {
      function handleFragmentType(val){
        $("#tab-users-link").click();
        $(".add_users_link:visible").click();
        $("#enroll_users_form select[name='enrollment_type']").val(val);
      }
      if(hash == "#add_students") {
        handleFragmentType("StudentEnrollment");
      } else if(hash == "#add_tas") {
        handleFragmentType("TaEnrollment");
      } else if(hash == "#add_teacher") {
        handleFragmentType("TeacherEnrollment");
      }
    });
    $(".edit_course_link").click(function(event) {
      event.preventDefault();
      $("#course_form").addClass('editing').find(":text:first").focus().select();
      $("#course_account_id_lookup").autocomplete({
        source: $("#course_account_id_url").attr('href'),
        select: function(event, ui){
          $("#course_account_id").val(ui.item.id);
        }
      });
    });
    $(".move_course_link").click(function(event) {
      event.preventDefault();
      $("#move_course_dialog").dialog({
        title: I18n.t('titles.move_course', "Move Course"),
        width: 500
      }).fixDialogButtons();
    });
    $("#move_course_dialog").delegate('.cancel_button', 'click', function() {
      $("#move_course_dialog").dialog('close');
    });
    $course_form.find(".grading_standard_checkbox").change(function() {
      $course_form.find(".grading_standard_link").showIf($(this).attr('checked'));
    }).change();
    $course_form.formSubmit({
      processData: function(data) {
        var date = $.datetime.parse(data['course[start_at]']);
        if (date) {
          date.setHours(0); date.setMinutes(0); date.setSeconds(0); date.setMilliseconds(0);
        }
        data['course[start_at]'] = date ? $.unfudgeDateForProfileTimezone(date).toISOString() : "";

        date = $.datetime.parse(data['course[conclude_at]']);
        if (date) {
          date.setHours(23); date.setMinutes(55); date.setSeconds(0); date.setMilliseconds(0);
        }
        data['course[conclude_at]'] = date ? $.unfudgeDateForProfileTimezone(date).toISOString() : "";

        return data;
      },
      beforeSubmit: function(data) {
        $(this).loadingImage().removeClass('editing');
        // arrivu changes
        $(this).find(".readable_license,.account_name,.term_name,.grading_scheme_set,.topic_name").text("...");
        // arrivu changes
        $(this).find(".storage_quota_mb").text(data['course[storage_quota_mb]']);
        $(".course_form_more_options").hide();
      },
      success: function(data) {
        var course = data.course;
        course.start_at = $.datetimeString(course.start_at);
        course.conclude_at = $.datetimeString(course.conclude_at);
        course.is_public = course.is_public ? I18n.t('public_course', 'Public') : I18n.t('private_course', 'Private');
        course.indexed = course.indexed ? I18n.t('indexed_course', "Included in public course index") : "";
        course.grading_scheme_set = course.grading_standard_title || (course.grading_standard_id ? I18n.t('grading_standard_set', "Currently Set") : I18n.t('grading_standard_unset', "Not Set"));
        course.restrict_dates = course.restrict_enrollments_to_course_dates ? I18n.t('course_dates_enforced', "Users can only participate in the course between these dates") : I18n.t('course_dates_unenforced', "These dates will not affect course availability");
        course.locale = $("#course_locale option[value='" + (course.locale || '') + "']").text();
        if (course.locale != $course_form.find('.locale').text()) {
          location.reload();
          return;
        }
        $(this).loadingImage('remove');
        $("#course_form .public_options").showIf(course.is_public);
        $("#course_form .self_enrollment_message").css('display', course.self_enrollment ? '' : 'none');
        $("#course_form").fillTemplateData({data: course});
        if (course.self_enrollment_code) {
          $("#course_form .self_enrollment_message b").each(function() {
            $(this).text($.replaceTags($(this).text(), 'self_enrollment_code', course.self_enrollment_code));
          });
        }
      },
      error: function(data) {
        $(this).loadingImage('remove');
        $(".edit_course_link").click();
        $(this).formErrors(data);
      }
    })
    .find(".cancel_button")
      .click(function() {
        $course_form.removeClass('editing');
        $(".course_form_more_options").hide();
      }).end()
    .find(":text:not(.date_entry)").keycodes('esc', function() {
      $course_form.find(".cancel_button:first").click();
    });
    $(".associated_user_link").click(function(event) {
      event.preventDefault();
      var $user = $(this).parents(".user");
      var $enrollment = $(this).parents(".enrollment_link");
      var user_data = $user.getTemplateData({textValues: ['name']});
      var enrollment_data = $enrollment.getTemplateData({textValues: ['enrollment_id', 'associated_user_id']});
      link_enrollment.choose(user_data.name, enrollment_data.enrollment_id, enrollment_data.associated_user_id, function(enrollment) {
        if(enrollment) {
          var $user = $(".observer_enrollments .user_" + enrollment.user_id)
          var $enrollment_link = $user.find(".enrollment_link.enrollment_" + enrollment.id)
          $enrollment_link.find(".associated_user.associated").showIf(enrollment.associated_user_id)
          $enrollment_link.fillTemplateData({data: enrollment});
          $enrollment_link.find(".associated_user.unassociated").showIf(!enrollment.associated_user_id);
        }
      });
    });
    $(".course_info").not('.uneditable').attr('title', I18n.t('titles.click_to_edit', 'Click to Edit')).click(function(event) {
      if (event.target.nodeName == "INPUT") {
        return;
      }
      $(".edit_course_link:first").click();
      var $obj = $(this).parents("td").find(".course_form");
      if($obj.length) {
        $obj.focus().select();
      }
    });
    $(".course_form_more_options_link").click(function(event) {
      event.preventDefault();
      var $moreOptions = $(".course_form_more_options");
      var optionText = $moreOptions.is(':visible') ? I18n.t('links.more_options', 'more options') : I18n.t('links.fewer_options', 'fewer options');
      $(this).text(optionText);
      $moreOptions.slideToggle();
    });
   $enrollment_dialog.find(".cancel_button").click(function() {
      $enrollment_dialog.dialog('close');
    });

    $enrollment_dialog.find(".re_send_invitation_link").click(function(event) {
      event.preventDefault();
      var $link = $(this);
      $link.text(I18n.t('links.re_sending_invitation', "Re-Sending Invitation..."));
      var url = $link.attr('href');
      $.ajaxJSON(url, 'POST', {}, function(data) {
        $enrollment_dialog.fillTemplateData({data: {invitation_sent_at: I18n.t('invitation_sent_now', "Just Now")}});
        $link.text(I18n.t('invitation_sent', "Invitation Sent!"));
        var $user = $enrollment_dialog.data('user');
        if($user) {
          $user.fillTemplateData({data: {invitation_sent_at: I18n.t('invitation_sent_now', "Just Now")}});
        }
      }, function(data) {
        $link.text(I18n.t('errors.invitation', "Invitation Failed.  Please try again."));
      });
    });
    $(".date_entry").datetime_field({alwaysShowTime: true});

    $().data('current_default_wiki_editing_roles', $("#course_default_wiki_editing_roles").val());
    $("#course_default_wiki_editing_roles").change(function() {
      var $this = $(this);
      $(".changed_default_wiki_editing_roles").showIf($this.val() != $().data('current_default_wiki_editing_roles'));
      $(".default_wiki_editing_roles_change").text($this.find(":selected").text());
    });

    $(".re_send_invitations_link").click(function(event) {
      event.preventDefault();
      var $button = $(this),
          oldText = I18n.t('links.re_send_all', "Re-Send All Unaccepted Invitations");

      $button.text(I18n.t('buttons.re_sending_all', "Re-Sending Unaccepted Invitations...")).attr('disabled', true);
      $.ajaxJSON($button.attr('href'), 'POST', {}, function(data) {
        $button.text(I18n.t('buttons.re_sent_all', "Re-Sent All Unaccepted Invitations!")).attr('disabled', false);
        $(".user_list .user.pending").each(function() {
          var $user = $(this);
          $user.fillTemplateData({data: {invitation_sent_at: I18n.t('invitation_sent_now', "Just Now")}});
        });
        setTimeout(function() {
          $button.text(oldText);
        }, 2500);
      }, function() {
        $button.text(I18n.t('errors.re_send_all', "Send Failed, Please Try Again")).attr('disabled', false);
      });
    });
    $("#enrollment_type").change(function() {
      $(".teacherless_invite_message").showIf($(this).find(":selected").hasClass('teacherless_invite'));
    });
    $(".is_public_checkbox").change(function() {
      $(".public_options").showIf($(this).attr('checked'));
    }).change();

    $(".self_enrollment_checkbox").change(function() {
      $(".open_enrollment_holder").showIf($(this).attr('checked'));
    }).change();

    $("#publish_grades_link").click(function(event) {
      event.preventDefault();
      GradePublishing.publish();
    });
    if (typeof(sisPublishEnabled) != 'undefined' && sisPublishEnabled) {
      GradePublishing.checkup();
    }

    $(".reset_course_content_button").click(function(event) {
      event.preventDefault();
      $("#reset_course_content_dialog").dialog({
        title: I18n.t('titles.reset_course_content_dialog_help', "Reset Course Content"),
        width: 500
      });

      $(".ui-dialog").focus();
    }).fixDialogButtons();
    $("#reset_course_content_dialog .cancel_button").click(function() {
      $("#reset_course_content_dialog").dialog('close');
    });

    $.scrollSidebar();
      $(".configure_report_link").click(function(event) {
          event.preventDefault();
          var data = $(this).data(),
              $dialog = data.$report_dialog;
          if (!$dialog) {
              $dialog = data.$report_dialog = $(this).parent("td").find(".report_dialog").dialog({
                  autoOpen: false,
                  width: 400,
                  title: I18n.t('titles.configure_report', 'Configure Report')
              });
              $dialog.find(".datetime_field").datetime_field()
          }
          $dialog.dialog('open');
      })

      $(".run_report_link").click(function(event) {
          event.preventDefault();
          $(this).parent("form").submit();
      });

      $(".run_report_form").formSubmit({
          resetForm: true,
          beforeSubmit: function(data) {
              $(this).loadingImage();
              return true;
          },
          success: function(data) {
              $(this).loadingImage('remove');
              var report = $(this).attr('id').replace('_form', '');
              $("#" + report).find('.run_report_link').hide()
                  .end().find('.configure_report_link').hide()
                  .end().find('.running_report_message').show();
              $(this).parent(".report_dialog").dialog('close');
          },
          error: function(data) {
              $(this).loadingImage('remove');
              $(this).parent(".report_dialog").dialog('close');
          }
      });
      //arrivu changes
      $("#tab-images").find(".upload_new_image_link").click(function(){
          $("#upload_image_form").toggle()
      });
      $("#tab-images").find(".upload_new_background_image_link").click(function(){
          $("#upload_background_image_form").toggle()
      });
      $upload_image_form.formSubmit({
          fileUpload: true,
          preparedFileUpload: true,
          singleFile: true,
          object_name: 'attachment',
          context_code: $("#editor_tabs .context_code").text(),
          folder_id: function() {
              return $(this).find("[name='attachment[folder_id]']").val();
          },
          upload_only: true,
          processData: function(data) {
              data['attachment[display_name]'] = $upload_image_form.find(".file_name").val();
              return data;
          },
          beforeSubmit: function(data) {
              $upload_image_form.find(".uploading").slideDown();
              var val= $("#upload_image_form").find("#attachment_uploaded_data").val() ;
              if(val === ""){
                  $upload_image_form.find(".uploading").slideUp();
                  alert("Please choose a file to upload");

              }
          },
          success: function(data){
              course_id = $("#upload_background_image_form").find(".uploading").attr('id'),
                  course_image = $('#course_image');
              course_image.attr('src', "/courses/"+course_id+"/files/"+ data.attachment.id +"/preview");
              $upload_image_form.find(".uploading").hide();
          },
          error: function(data) {
              $upload_image_form.find(".uploading").slideUp();

          }

      });
      $upload_back_ground_image_form.formSubmit({
          fileUpload: true,
          preparedFileUpload: true,
          singleFile: true,
          object_name: 'attachment',
          context_code: $("#editor_tabs .context_code").text(),
          folder_id: function() {
              return $(this).find("[name='attachment[folder_id]']").val();
          },
          upload_only: true,
          processData: function(data) {
              data['attachment[display_name]'] =  $upload_back_ground_image_form.find(".file_name").val();
              return data;
          },
          beforeSubmit: function(data) {
              $upload_back_ground_image_form.find(".uploading").slideDown();
              var val=$("#upload_background_image_form").find("#attachment_uploaded_data").val() ;
              if(val === ""){
                  $upload_back_ground_image_form.find(".uploading").slideUp();
                  alert("Please choose a file to upload");
              }
          },
          success: function(data){
              course_id = $("#upload_background_image_form").find(".uploading").attr('id');
              course_background_image = $('#course_background_image');
              course_background_image.attr('src', "/courses/"+course_id+"/files/"+ data.attachment.id +"/preview");
              $upload_back_ground_image_form.find(".uploading").hide();

          }
      });
      $("#course_make_this_course_visible_on_course_catalogue").click(function(event){
          var public_visible = true;
          $(".success_message").css("display","none");
          $(".user_messages").css("display","none");
          $(".heading").css("display","none");
          if($(this).is(":checked")) {
          $("#course_visibility_catalogue_check").dialog({
              width: 570,
              height:590
          });
          $("#course_visibility_catalogue_check").disableWhileLoading($.ajax({
              type:'GET',
              url:$("#course_visibility_catalogue_check").attr('path'),
              success: function(data){
                  console.log(data);
                if (data.course_image != null){
                    $("#course_image_graded").css("display","");
                } else{
                    $("#course_image_not_graded").css("display","");
                    public_visible=false;
                }
                if (data.course_background_image != null){
                    $("#course_background_image_graded").css("display","");
                }else {
                    $("#course_background_image_not_graded").css("display","");
                    public_visible=false;
                }
                if (data.long_desc != null){
                    $("#course_desc_graded").css("display","");
                }else{
                    $("#course_desc_not_graded").css("display","");
                    public_visible=false;
                }
                if (data.course_short_decription != null){
                    $("#course_short_desc_graded").css("display","");
                }else {
                    $("#course_short_desc_not_graded").css("display","");
                    public_visible=false;
                }
                if (data.account_profile_enabled == 0){
                    public_visible=false;
                    $( "#course_visibility_catalogue_check" ).append( "<div class='account_disabled' style='margin-top: 23px;position: absolute;color:red;top: 0;right: 0;margin-right: 170px;'>Account Profile Feature is not Enabled</div>");
                    $("#course_teachers_not_graded").css("display","");
                    $("#course_teachers_graded").css("display","none");
                    teacher_list_check(data);

                } else{
                if (data.profile_check_passed != 0)  {
                    $("#course_teachers_graded").css("display","");
                }else {
                    $("#course_teachers_not_graded").css("display","");
                    teacher_list_check(data);
                    public_visible=false;
                }
                }
                if (data.course_tags != 0) {
                    $("#course_tags_graded").css("display","");
                    $("#course_tags_not_graded").css("display","none");
                }else {
                    $("#course_tags_graded").css("display","none");
                    $("#course_tags_not_graded").css("display","");
                    public_visible=false;
                }
                if (public_visible == false){
                  $("#course_make_this_course_visible_on_course_catalogue").removeAttr('checked');
                  $(".user_messages").css("display","");
                  $(".heading").css("display","");
                }else{
                    $(".success_message").css("display","");
                    $(".user_messages").css("display","none");
                    $(".heading").css("display","none");
                }
              }
          })
          );
          }
         $(".ui-dialog-titlebar").removeClass("ui-widget-header");
       });
      $("#dialog_close").click(function(){
          $("#course_visibility_catalogue_check").dialog('close');
      });
      function teacher_list_check(data){
          var list = $(".teacher_list");
          for ( var i = 0; i < data.teacher_users.length; i++ ) {
              if (data.teacher_users[i].completed == true){
                  path = '/images/graded.16px.png'
              }else{
                  path = '/images/not_graded.16px.png'
              }
              $(list).append(
                  $("<li>", {style:'width:75%;margin-left:22px;',html:data.teacher_users[i].name }).append(
                      $("<img>", {style: 'float:right;',src: path})
                  )
              );
          }
      }
  //end of arrivu chnages
  });
});
